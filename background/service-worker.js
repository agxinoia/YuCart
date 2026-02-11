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
async function updateImageRules() {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [DNR_RULE_ID],
      addRules: [{
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
      }]
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
});

chrome.runtime.onInstalled.addListener(async () => {
  const cart = await getCart();
  updateBadge(cart);
  const settings = await getSettings();
  await fetchExchangeRate(settings.targetCurrency);
  await updateImageRules();
});

// ── Message handler ──────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
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
        // Popup calls this before rendering to refresh DNR cookie rules
        await updateImageRules();
        sendResponse({ success: true });
        break;
      }
      default:
        sendResponse({ error: 'Unknown action' });
    }
  })();
  return true; // keep channel open for async
});
