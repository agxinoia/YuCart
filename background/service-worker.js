/* ============================================================
   YuCart — Background Service Worker
   Handles: currency API, cart storage, badge updates,
            DNR rules for image loading
   ============================================================ */

const RATE_CACHE_KEY = 'yucart_exchange_rate';
const RATE_TTL = 6 * 60 * 60 * 1000; // 6 hours
const CART_KEY = 'yucart_cart';
const SETTINGS_KEY = 'yucart_settings';
const DNR_RULE_ID = 1;

const DEFAULT_SETTINGS = {
  targetCurrency: 'USD',
  darkMode: true  // Dark mode enabled by default
};

// ── Update Checking ──────────────────────────────────────────
const UPDATE_CHECK_ALARM = 'yucart_update_check';
const UPDATE_CHECK_INTERVAL_MINUTES = 360; // 6 hours
const VERSION_URL = 'https://raw.githubusercontent.com/agxinoia/YuCart/main/version.json';
const UPDATE_STORAGE_KEY = 'yucart_update_info';

// Check for updates by comparing against GitHub version file
async function checkForUpdates() {
  try {
    const currentVersion = chrome.runtime.getManifest().version;
    const response = await fetch(VERSION_URL);
    if (!response.ok) {
      console.log('[YuCart] Update check failed:', response.status);
      return;
    }

    const data = await response.json();

    if (compareVersions(data.version, currentVersion) > 0) {
      // New version available
      const updateInfo = {
        updateAvailable: true,
        latestVersion: data.version,
        releaseUrl: data.releaseUrl || 'https://github.com/agxinoia/YuCart/releases/latest',
        updateMessage: data.message || 'New update available with improvements and bug fixes!',
        checkedAt: Date.now()
      };

      await chrome.storage.local.set({ [UPDATE_STORAGE_KEY]: updateInfo });

      // Show badge on extension icon
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#FF6B35' });

      console.log('[YuCart] ✨ Update available:', data.version);
    } else {
      // Clear any previous update notification
      await chrome.storage.local.set({
        [UPDATE_STORAGE_KEY]: {
          updateAvailable: false,
          checkedAt: Date.now()
        }
      });
      console.log('[YuCart] ✅ Already on latest version');
    }
  } catch (error) {
    console.error('[YuCart] Failed to check for updates:', error);
  }
}

// Compare two semantic version strings (e.g., "1.2.0" vs "1.3.0")
// Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    if (parts1[i] > parts2[i]) return 1;
    if (parts1[i] < parts2[i]) return -1;
  }
  return 0;
}

// Schedule periodic update checks using chrome.alarms (survives SW restarts)
function scheduleUpdateAlarm() {
  chrome.alarms.create(UPDATE_CHECK_ALARM, {
    periodInMinutes: UPDATE_CHECK_INTERVAL_MINUTES
  });
}

// Listen for alarm events
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_CHECK_ALARM) {
    checkForUpdates();
  }
});

// ── Fetch exchange rate ──────────────────────────────────────
async function fetchExchangeRate(targetCurrency = 'USD') {
  try {
    const resp = await fetch(`https://open.er-api.com/v6/latest/CNY`);
    const data = await resp.json();
    if (data.result === 'success') {
      const rate = data.rates[targetCurrency] || 1;
      const cache = {
        rate,
        base: 'CNY',
        target: targetCurrency,
        allRates: data.rates,
        fetchedAt: Date.now()
      };
      await chrome.storage.local.set({ [RATE_CACHE_KEY]: cache });
      return cache;
    }
  } catch (e) {
    console.error('YuCart: Failed to fetch exchange rate', e);
  }
  return null;
}

async function getExchangeRate(targetCurrency) {
  const result = await chrome.storage.local.get(RATE_CACHE_KEY);
  const cached = result[RATE_CACHE_KEY];
  if (cached && cached.target === targetCurrency && (Date.now() - cached.fetchedAt) < RATE_TTL) {
    return cached;
  }
  return await fetchExchangeRate(targetCurrency);
}

// ── DNR: Inject cookies into popup image requests ────────────
// The content script needs to draw Yupoo images to canvas to
// extract base64 data. But photo.yupoo.com is cross-origin from
// vendor.x.yupoo.com, so canvas gets tainted. We use DNR to add
// CORS headers to the response, allowing canvas access.
function buildImageCorsRule() {
  return {
    id: DNR_RULE_ID,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      responseHeaders: [
        { header: 'Access-Control-Allow-Origin', operation: 'set', value: '*' }
      ]
    },
    condition: {
      urlFilter: '||photo.yupoo.com',
      resourceTypes: ['image', 'xmlhttprequest', 'other']
    }
  };
}

function normalizeDnrRule(rule) {
  return {
    id: rule.id,
    priority: rule.priority,
    action: rule.action,
    condition: {
      urlFilter: rule.condition?.urlFilter,
      resourceTypes: [...(rule.condition?.resourceTypes || [])].sort()
    }
  };
}

async function updateImageRules() {
  try {
    const desiredRule = buildImageCorsRule();
    const dynamicRules = await chrome.declarativeNetRequest.getDynamicRules();
    const existingRule = dynamicRules.find((rule) => rule.id === DNR_RULE_ID);

    if (
      existingRule &&
      JSON.stringify(normalizeDnrRule(existingRule)) === JSON.stringify(normalizeDnrRule(desiredRule))
    ) {
      return;
    }

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [DNR_RULE_ID],
      addRules: [desiredRule]
    });
    console.log('[YuCart BG] ✅ DNR CORS rules set for photo.yupoo.com');
  } catch (e) {
    console.error('[YuCart BG] ❌ Failed to update DNR rules:', e);
  }
}

// ── Cart operations ──────────────────────────────────────────
async function getCart() {
  const result = await chrome.storage.local.get(CART_KEY);
  return result[CART_KEY] || [];
}

async function saveCart(cart) {
  await chrome.storage.local.set({ [CART_KEY]: cart });
  updateBadge(cart);
}

async function addToCart(item) {
  const cart = await getCart();
  const existing = cart.find(i =>
    i.title === item.title && i.vendor === item.vendor && i.price === item.price
  );
  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      title: item.title || 'Untitled Item',
      price: parseFloat(item.price) || 0,
      vendor: item.vendor || 'Unknown',
      thumbnail: item.thumbnail || '',
      url: item.url || '',
      subtitle: item.subtitle || '',
      quantity: 1,
      addedAt: Date.now()
    });
  }
  await saveCart(cart);
  return cart;
}

async function removeFromCart(itemId) {
  let cart = await getCart();
  cart = cart.filter(i => i.id !== itemId);
  await saveCart(cart);
  return cart;
}

async function updateQuantity(itemId, quantity) {
  const cart = await getCart();
  const item = cart.find(i => i.id === itemId);
  if (item) {
    item.quantity = Math.max(1, quantity);
  }
  await saveCart(cart);
  return cart;
}

async function updateItemTitle(itemId, cleanedTitle) {
  const cart = await getCart();
  const item = cart.find(i => i.id === itemId);
  if (item) {
    item.cleanedTitle = cleanedTitle;
  }
  await saveCart(cart);
  return cart;
}

async function updateItemTitlesBatch(updates = []) {
  if (!Array.isArray(updates) || updates.length === 0) {
    return await getCart();
  }

  const cart = await getCart();
  const titlesById = new Map();
  let hasUpdates = false;

  for (const update of updates) {
    const itemId = String(update?.itemId || '').trim();
    const cleanedTitle = String(update?.cleanedTitle || '').trim();
    if (!itemId || !cleanedTitle) continue;
    titlesById.set(itemId, cleanedTitle);
  }

  for (const item of cart) {
    const nextTitle = titlesById.get(item.id);
    if (!nextTitle || item.cleanedTitle === nextTitle) continue;
    item.cleanedTitle = nextTitle;
    hasUpdates = true;
  }

  if (hasUpdates) {
    await saveCart(cart);
  }
  return cart;
}

async function resetCleanedNames() {
  const cart = await getCart();
  for (const item of cart) {
    delete item.cleanedTitle;
  }
  await saveCart(cart);
  return cart;
}

async function clearCart() {
  await saveCart([]);
  return [];
}

// ── Settings ─────────────────────────────────────────────────
async function getSettings() {
  const result = await chrome.storage.sync.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) };
}

// ── Badge ────────────────────────────────────────────────────
function updateBadge(cart) {
  const count = cart.reduce((sum, i) => sum + i.quantity, 0);
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#e94560' });
}

// ── Init ─────────────────────────────────────────────────────
chrome.runtime.onStartup?.addListener(async () => {
  const cart = await getCart();
  updateBadge(cart);
  await updateImageRules();
  checkForUpdates();
  scheduleUpdateAlarm();
});

chrome.runtime.onInstalled.addListener(async () => {
  const cart = await getCart();
  updateBadge(cart);
  const settings = await getSettings();
  await fetchExchangeRate(settings.targetCurrency);
  await updateImageRules();
  checkForUpdates();
  scheduleUpdateAlarm();
});

// ── Message handler ──────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.action) {
        case 'addToCart': {
          const cart = await addToCart(msg.item);
          sendResponse({ success: true, cart });
          break;
        }
        case 'getCart': {
          const cart = await getCart();
          sendResponse({ cart });
          break;
        }
        case 'removeFromCart': {
          const cart = await removeFromCart(msg.itemId);
          sendResponse({ success: true, cart });
          break;
        }
        case 'updateQuantity': {
          const cart = await updateQuantity(msg.itemId, msg.quantity);
          sendResponse({ success: true, cart });
          break;
        }
        case 'updateItemTitle': {
          const cart = await updateItemTitle(msg.itemId, msg.cleanedTitle);
          sendResponse({ success: true, cart });
          break;
        }
        case 'updateItemTitlesBatch': {
          const cart = await updateItemTitlesBatch(msg.updates);
          sendResponse({ success: true, cart });
          break;
        }
        case 'resetCleanedNames': {
          const cart = await resetCleanedNames();
          sendResponse({ success: true, cart });
          break;
        }
        case 'clearCart': {
          const cart = await clearCart();
          sendResponse({ success: true, cart });
          break;
        }
        case 'getRate': {
          const settings = await getSettings();
          const target = msg.currency || settings.targetCurrency;
          const rateData = await getExchangeRate(target);
          sendResponse({ rateData });
          break;
        }
        case 'refreshRate': {
          const settings = await getSettings();
          const target = msg.currency || settings.targetCurrency;
          const rateData = await fetchExchangeRate(target);
          sendResponse({ rateData });
          break;
        }
        case 'getSettings': {
          const settings = await getSettings();
          sendResponse({ settings });
          break;
        }
        case 'prepareImages': {
          // Kept for compatibility with older popup builds.
          await updateImageRules();
          sendResponse({ success: true });
          break;
        }
        case 'getUpdateInfo': {
          const result = await chrome.storage.local.get(UPDATE_STORAGE_KEY);
          const updateInfo = result[UPDATE_STORAGE_KEY] || { updateAvailable: false };
          sendResponse({ updateInfo });
          break;
        }
        case 'dismissUpdate': {
          await chrome.storage.local.set({
            [UPDATE_STORAGE_KEY]: {
              updateAvailable: false,
              dismissed: true,
              dismissedAt: Date.now()
            }
          });
          // Clear badge if cart is empty
          const cart = await getCart();
          updateBadge(cart);
          sendResponse({ success: true });
          break;
        }
        default:
          sendResponse({ error: 'Unknown action' });
      }
    } catch (error) {
      console.error('[YuCart BG] Message handler failed:', error);
      sendResponse({ error: error?.message || 'Unexpected background error' });
    }
  })();
  return true; // keep channel open for async
});
