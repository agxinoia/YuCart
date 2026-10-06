/* ============================================================
   YuCart — Background Service Worker
   Handles: currency API, cart storage, badge updates,
            DNR rules for image loading
   ============================================================ */

try {
  importScripts('../shared/agent-checkout-config.js');
} catch (error) {
  console.error('[YuCart BG] Failed to load agent checkout config:', error);
}

try {
  importScripts('../shared/au-freeship.js');
} catch (error) {
  console.error('[YuCart BG] Failed to load AU free shipping config:', error);
}

const RATE_CACHE_KEY = 'yucart_exchange_rate';
const RATE_TTL = 6 * 60 * 60 * 1000; // 6 hours
const CART_KEY = 'yucart_cart';
const WARDROBE_KEY = 'yucart_wardrobe';
const OUTFITS_KEY = 'yucart_outfits';
const SETTINGS_KEY = 'yucart_settings';
const LOCAL_SETTINGS_KEY = 'yucart_local_settings';
const DNR_RULE_ID = 1;
const {
  AGENT_CHECKOUT_CONFIG = {},
  getAgentCheckoutConfig = () => null
} = globalThis.YuCartAgentCheckout || {};
const AuFreeShip = globalThis.YuCartAuFreeShip || null;

const DEFAULT_SETTINGS = {
  targetCurrency: 'USD',
  darkMode: true,  // Dark mode enabled by default
  betaWardrobeEnabled: false,
  betaAuFreeShipEnabled: false,
  popupScale: 1
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
    if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
      console.log('[YuCart] Update check skipped (network error or blocked).');
    } else {
      console.log('[YuCart] Failed to check for updates:', error.message);
    }
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
    console.log('YuCart: Failed to fetch exchange rate', e.message);
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

  // If no subtitle (product source link), try to scrape it from the Yupoo detail page
  const target = existing || cart[cart.length - 1];
  if (!target.subtitle && target.url && target.url.includes('yupoo.com')) {
    scrapeSubtitle(target.id, target.url);
  }

  return cart;
}

// fetch() with a time limit on the whole response, body included. Chrome
// also stops an extension service worker whose fetch takes over 30s.
async function fetchTextWithTimeout(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { credentials: 'omit', signal: controller.signal });
    return resp.ok ? await resp.text() : '';
  } finally {
    clearTimeout(timer);
  }
}

// Fetch a Yupoo album page and return the product source link from its subtitle
async function fetchAlbumProductLink(albumUrl) {
  const html = await fetchTextWithTimeout(albumUrl);
  if (!html) return '';

  // Parse the gallerysubtitle anchor's href
  // Pattern: <a ... href="...external?url=ENCODED_URL..."...> inside gallerysubtitle
  const subtitleMatch = html.match(
    /gallerysubtitle[\s\S]*?<a[^>]+href=["']([^"']+)["']/i
  );
  if (!subtitleMatch) return '';

  const href = subtitleMatch[1];

  // Unwrap Yupoo redirect: /external?url=<encoded>
  const urlParam = href.match(/[?&]url=([^&]+)/);
  if (urlParam) {
    try {
      return decodeURIComponent(decodeURIComponent(urlParam[1]));
    } catch {
      return decodeURIComponent(urlParam[1]);
    }
  }
  return href;
}

async function scrapeSubtitle(itemId, albumUrl) {
  try {
    const productUrl = await fetchAlbumProductLink(albumUrl);
    if (!productUrl) return;

    // Only store if it's a known source site
    if (!/weidian\.com|taobao\.com|1688\.com/i.test(productUrl)) return;

    // Update the cart item's subtitle
    const cart = await getCart();
    const item = cart.find(i => i.id === itemId);
    if (item && !item.subtitle) {
      item.subtitle = productUrl;
      await saveCart(cart);
      console.log('[YuCart BG] Scraped subtitle for', itemId, ':', productUrl);
    }
  } catch (e) {
    console.warn('[YuCart BG] Subtitle scrape failed:', e.message);
  }
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
  const updatesById = new Map();
  let hasUpdates = false;

  for (const update of updates) {
    const itemId = String(update?.itemId || '').trim();
    const cleanedTitle = String(update?.cleanedTitle || '').trim();
    if (!itemId || !cleanedTitle) continue;
    updatesById.set(itemId, {
      cleanedTitle,
      itemType: update.itemType || null,
      color: update.color || null
    });
  }

  for (const item of cart) {
    const update = updatesById.get(item.id);
    if (!update) continue;
    if (item.cleanedTitle !== update.cleanedTitle) {
      item.cleanedTitle = update.cleanedTitle;
      hasUpdates = true;
    }
    if (update.itemType && item.itemType !== update.itemType) {
      item.itemType = update.itemType;
      hasUpdates = true;
    }
    if (update.color && item.color !== update.color) {
      item.color = update.color;
      hasUpdates = true;
    }
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
    delete item.itemType;
    delete item.color;
  }
  await saveCart(cart);
  return cart;
}

async function clearCart() {
  await saveCart([]);
  return [];
}



// ── Wardrobe operations ──────────────────────────────────────
async function getWardrobe() {
  const result = await chrome.storage.local.get(WARDROBE_KEY);
  return result[WARDROBE_KEY] || [];
}

async function saveWardrobe(wardrobe) {
  await chrome.storage.local.set({ [WARDROBE_KEY]: wardrobe });
}

async function addToWardrobe(item) {
  const wardrobe = await getWardrobe();
  const existing = wardrobe.find(i => i.url === item.url);
  if (existing) return wardrobe;
  wardrobe.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    title: item.title || 'Untitled Item',
    cleanedTitle: item.cleanedTitle || '',
    price: parseFloat(item.price) || 0,
    vendor: item.vendor || 'Unknown',
    thumbnail: item.thumbnail || '',
    url: item.url || '',
    addedAt: Date.now(),
    sourceCartId: item.sourceCartId || ''
  });
  await saveWardrobe(wardrobe);
  return wardrobe;
}

async function removeFromWardrobe(itemId) {
  let wardrobe = await getWardrobe();
  wardrobe = wardrobe.filter(i => i.id !== itemId);
  await saveWardrobe(wardrobe);
  return wardrobe;
}

async function clearWardrobe() {
  await saveWardrobe([]);
  return [];
}

// ── Outfit operations ────────────────────────────────────────
async function getOutfits() {
  const result = await chrome.storage.local.get(OUTFITS_KEY);
  return result[OUTFITS_KEY] || [];
}

async function saveOutfitToStorage(outfit) {
  const outfits = await getOutfits();
  outfit.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  outfit.createdAt = Date.now();
  outfits.push(outfit);
  if (outfits.length > 10) outfits.shift();
  await chrome.storage.local.set({ [OUTFITS_KEY]: outfits });
  return outfits;
}

async function deleteOutfit(outfitId) {
  let outfits = await getOutfits();
  outfits = outfits.filter(o => o.id !== outfitId);
  await chrome.storage.local.set({ [OUTFITS_KEY]: outfits });
  return outfits;
}

// ── Settings ─────────────────────────────────────────────────
async function getSettings() {
  const [syncResult, localResult] = await Promise.all([
    chrome.storage.sync.get(SETTINGS_KEY),
    chrome.storage.local.get(LOCAL_SETTINGS_KEY)
  ]);

  return {
    ...DEFAULT_SETTINGS,
    ...(syncResult[SETTINGS_KEY] || {}),
    ...(localResult[LOCAL_SETTINGS_KEY] || {})
  };
}

async function isWardrobeBetaEnabled() {
  const settings = await getSettings();
  return settings.betaWardrobeEnabled === true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTabComplete(tabId, timeoutMs = 30000) {
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(() => {
      finish();
    }, timeoutMs);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        finish();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab?.status === 'complete') {
        finish();
      }
    }).catch(() => {
      // The timeout or onUpdated listener will resolve if the tab still exists.
    });
  });
}

async function runScriptInTab(tabId, func, args = [], world = 'ISOLATED') {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func,
      args,
      world
    });
    return results?.[0]?.result ?? null;
  } catch (error) {
    console.warn('[YuCart BG] Script execution failed:', error?.message || error);
    return null;
  }
}

function inspectAgentCheckoutPage(config) {
  const selectors = {
    ready: Array.isArray(config?.readySelectors) ? config.readySelectors : [],
    add: Array.isArray(config?.addToCartSelectors) ? config.addToCartSelectors : [],
    login: Array.isArray(config?.loginGateSelectors) ? config.loginGateSelectors : []
  };
  const readyTextPatterns = Array.isArray(config?.readyTextPatterns) ? config.readyTextPatterns : [];
  const addTextPatterns = Array.isArray(config?.addToCartTextPatterns) ? config.addToCartTextPatterns : [];
  const loginTextPatterns = Array.isArray(config?.loginTextPatterns) ? config.loginTextPatterns : [];
  const failureTextPatterns = Array.isArray(config?.failureTextPatterns) ? config.failureTextPatterns : [];
  const securityTextPatterns = Array.isArray(config?.securityTextPatterns) ? config.securityTextPatterns : [];

  const isVisible = (element) => !!(element && (element.offsetWidth || element.offsetHeight || element.getClientRects().length));
  const elementText = (element) => `${element?.innerText || element?.textContent || ''} ${element?.className || ''} ${element?.id || ''}`
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const bodyText = `${document.title || ''} ${document.body?.innerText || ''}`.replace(/\s+/g, ' ').trim().toLowerCase();

  const hasPattern = (text, patterns) => patterns.some((pattern) => text.includes(String(pattern).toLowerCase()));
  const hasVisibleSelector = (list) => list.some((selector) => {
    try {
      return Array.from(document.querySelectorAll(selector)).some(isVisible);
    } catch {
      return false;
    }
  });
  const hasVisiblePattern = (patterns) => {
    if (!patterns.length) return false;
    if (hasPattern(bodyText, patterns)) return true;
    return Array.from(document.querySelectorAll('body *')).some((element) => isVisible(element) && hasPattern(elementText(element), patterns));
  };
  const hasVisibleLoginGate = () => {
    if (hasVisibleSelector(selectors.login)) return true;

    const modalSelectors = [
      '.ant-modal',
      '.ant-modal-content',
      '.el-dialog',
      '.el-overlay',
      '.ivu-modal',
      '.ivu-modal-content',
      '.n-dialog',
      '[class*="modal"]',
      '[class*="dialog"]'
    ];

    for (const selector of modalSelectors) {
      try {
        const nodes = Array.from(document.querySelectorAll(selector));
        for (const node of nodes) {
          if (!isVisible(node)) continue;
          if (hasPattern(elementText(node), loginTextPatterns)) {
            return true;
          }
        }
      } catch {
        // Ignore invalid selectors.
      }
    }

    return false;
  };

  if (hasVisiblePattern(securityTextPatterns)) {
    return { status: 'security_check' };
  }

  if (
    hasVisibleSelector(selectors.ready) ||
    hasVisibleSelector(selectors.add) ||
    hasVisiblePattern(readyTextPatterns) ||
    hasVisiblePattern(addTextPatterns)
  ) {
    return { status: 'ready' };
  }

  if (hasVisibleLoginGate()) {
    return { status: 'login_required' };
  }

  if (hasVisiblePattern(failureTextPatterns)) {
    return { status: 'blocked' };
  }

  return { status: 'not_ready' };
}

function clickAgentAddToCart(config) {
  const selectors = Array.isArray(config?.addToCartSelectors) ? config.addToCartSelectors : [];
  const addTextPatterns = (Array.isArray(config?.addToCartTextPatterns) ? config.addToCartTextPatterns : [])
    .map((pattern) => String(pattern).toLowerCase());
  const loginTextPatterns = (Array.isArray(config?.loginTextPatterns) ? config.loginTextPatterns : [])
    .map((pattern) => String(pattern).toLowerCase());
  const failureTextPatterns = (Array.isArray(config?.failureTextPatterns) ? config.failureTextPatterns : [])
    .map((pattern) => String(pattern).toLowerCase());
  const securityTextPatterns = (Array.isArray(config?.securityTextPatterns) ? config.securityTextPatterns : [])
    .map((pattern) => String(pattern).toLowerCase());
  const agreementTextPatterns = (Array.isArray(config?.agreementTextPatterns) ? config.agreementTextPatterns : [])
    .map((pattern) => String(pattern).toLowerCase());
  const cartBadgeSelectors = Array.isArray(config?.cartBadgeSelectors) ? config.cartBadgeSelectors : [];

  const isVisible = (element) => !!(element && (element.offsetWidth || element.offsetHeight || element.getClientRects().length));
  const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const getElementText = (element) => normalizeText(`${element?.innerText || element?.textContent || ''} ${element?.className || ''} ${element?.id || ''}`);
  const bodyText = normalizeText(`${document.title || ''} ${document.body?.innerText || ''}`);
  const matchesAny = (text, patterns) => patterns.some((pattern) => text.includes(pattern));
  const isDisabled = (element) => {
    if (!element) return true;
    if (element.disabled) return true;
    const ariaDisabled = element.getAttribute?.('aria-disabled');
    return ariaDisabled === 'true';
  };
  const readCartCount = () => {
    for (const selector of cartBadgeSelectors) {
      try {
        const nodes = Array.from(document.querySelectorAll(selector));
        for (const node of nodes) {
          const text = normalizeText(node.textContent);
          const match = text.match(/\d+/);
          if (match) return Number.parseInt(match[0], 10);
        }
      } catch {
        // Ignore invalid selectors.
      }
    }
    return null;
  };
  const clickAgreement = () => {
    if (!agreementTextPatterns.length) return false;

    const checkboxCandidates = Array.from(document.querySelectorAll('input[type="checkbox"], [role="checkbox"]'));
    for (const candidate of checkboxCandidates) {
      if (!isVisible(candidate)) continue;
      if (candidate.checked || candidate.getAttribute?.('aria-checked') === 'true') continue;
      const container = candidate.closest('label, div, span') || candidate.parentElement || candidate;
      const text = getElementText(container);
      if (matchesAny(text, agreementTextPatterns)) {
        candidate.click();
        return true;
      }
    }

    const buttonCandidates = Array.from(document.querySelectorAll('label, button, span, div'));
    for (const candidate of buttonCandidates) {
      if (!isVisible(candidate)) continue;
      const text = getElementText(candidate);
      if (!text || text.length > 120) continue;
      if (matchesAny(text, agreementTextPatterns)) {
        candidate.click();
        return true;
      }
    }

    return false;
  };
  const hasVisibleLoginGate = () => {
    const modalSelectors = [
      ...(Array.isArray(config?.loginGateSelectors) ? config.loginGateSelectors : []),
      '.ant-modal',
      '.ant-modal-content',
      '.el-dialog',
      '.el-overlay',
      '.ivu-modal',
      '.ivu-modal-content',
      '.n-dialog',
      '[class*="modal"]',
      '[class*="dialog"]'
    ];

    for (const selector of modalSelectors) {
      try {
        const nodes = Array.from(document.querySelectorAll(selector));
        for (const node of nodes) {
          if (!isVisible(node)) continue;
          if (matchesAny(getElementText(node), loginTextPatterns)) {
            return true;
          }
        }
      } catch {
        // Ignore invalid selectors.
      }
    }

    return false;
  };
  const findCandidateFromSelectors = () => {
    for (const selector of selectors) {
      try {
        const nodes = Array.from(document.querySelectorAll(selector));
        for (const node of nodes) {
          if (!isVisible(node)) continue;
          const text = getElementText(node);
          if (addTextPatterns.length && text && !matchesAny(text, addTextPatterns)) continue;
          const clickable = node.closest('button, a, [role="button"]') || node;
          if (!isVisible(clickable) || isDisabled(clickable)) continue;
          return { node: clickable, selector };
        }
      } catch {
        // Ignore invalid selectors.
      }
    }
    return null;
  };
  const findCandidateByText = () => {
    const nodes = [
      ...Array.from(document.querySelectorAll('button, a, [role="button"]')),
      ...Array.from(document.querySelectorAll('span, div'))
    ];
    for (const node of nodes) {
      if (!isVisible(node)) continue;
      const text = getElementText(node);
      if (!text || !matchesAny(text, addTextPatterns)) continue;
      if (matchesAny(text, loginTextPatterns)) continue;
      const descendant = node.matches('button, a, [role="button"]')
        ? null
        : Array.from(node.querySelectorAll('button, a, [role="button"]')).find((candidate) => {
            if (!isVisible(candidate)) return false;
            return matchesAny(getElementText(candidate), addTextPatterns);
          });
      const clickable = descendant || node.closest('button, a, [role="button"]') || node;
      if (!isVisible(clickable) || isDisabled(clickable)) continue;
      return { node: clickable, selector: 'text-match' };
    }
    return null;
  };

  if (matchesAny(bodyText, securityTextPatterns)) {
    return { status: 'security_check' };
  }
  if (matchesAny(bodyText, failureTextPatterns)) {
    return { status: 'blocked' };
  }

  clickAgreement();

  const cartCountBefore = readCartCount();
  const candidate = findCandidateFromSelectors() || findCandidateByText();
  if (!candidate) {
    return { status: hasVisibleLoginGate() ? 'login_required' : 'not_found', cartCountBefore };
  }

  if (isDisabled(candidate.node)) {
    return { status: 'disabled', cartCountBefore };
  }

  candidate.node.scrollIntoView({ block: 'center', inline: 'center' });
  candidate.node.click();

  return {
    status: 'clicked',
    cartCountBefore,
    selector: candidate.selector,
    buttonText: getElementText(candidate.node)
  };
}

function verifyAgentCheckoutState(config, clickResult) {
  const successSelectors = Array.isArray(config?.successSelectors) ? config.successSelectors : [];
  const confirmSelectors = Array.isArray(config?.confirmSelectors) ? config.confirmSelectors : [];
  const loginGateSelectors = Array.isArray(config?.loginGateSelectors) ? config.loginGateSelectors : [];
  const cartBadgeSelectors = Array.isArray(config?.cartBadgeSelectors) ? config.cartBadgeSelectors : [];
  const loginTextPatterns = (Array.isArray(config?.loginTextPatterns) ? config.loginTextPatterns : [])
    .map((pattern) => String(pattern).toLowerCase());
  const failureTextPatterns = (Array.isArray(config?.failureTextPatterns) ? config.failureTextPatterns : [])
    .map((pattern) => String(pattern).toLowerCase());
  const securityTextPatterns = (Array.isArray(config?.securityTextPatterns) ? config.securityTextPatterns : [])
    .map((pattern) => String(pattern).toLowerCase());
  const successTextPatterns = (Array.isArray(config?.successTextPatterns) ? config.successTextPatterns : [])
    .map((pattern) => String(pattern).toLowerCase());

  const isVisible = (element) => !!(element && (element.offsetWidth || element.offsetHeight || element.getClientRects().length));
  const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const getElementText = (element) => normalizeText(`${element?.innerText || element?.textContent || ''} ${element?.className || ''} ${element?.id || ''}`);
  const matchesAny = (text, patterns) => patterns.some((pattern) => text.includes(pattern));
  const bodyText = normalizeText(`${document.title || ''} ${document.body?.innerText || ''}`);
  const strongSuccess = ['success', 'successfully', 'added', '加入', '已加入', '成功'];

  const hasVisibleSelector = (selectors) => selectors.some((selector) => {
    try {
      return Array.from(document.querySelectorAll(selector)).some(isVisible);
    } catch {
      return false;
    }
  });
  const clickVisibleConfirm = () => {
    for (const selector of confirmSelectors) {
      try {
        const candidate = Array.from(document.querySelectorAll(selector)).find(isVisible);
        if (candidate) {
          candidate.click();
          return true;
        }
      } catch {
        // Ignore invalid selectors.
      }
    }
    return false;
  };
  const hasVisibleLoginGate = () => {
    if (hasVisibleSelector(loginGateSelectors)) return true;

    const modalSelectors = [
      '.ant-modal',
      '.ant-modal-content',
      '.el-dialog',
      '.el-overlay',
      '.ivu-modal',
      '.ivu-modal-content',
      '.n-dialog',
      '[class*="modal"]',
      '[class*="dialog"]'
    ];

    for (const selector of modalSelectors) {
      try {
        const nodes = Array.from(document.querySelectorAll(selector));
        for (const node of nodes) {
          if (!isVisible(node)) continue;
          if (matchesAny(getElementText(node), loginTextPatterns)) {
            return true;
          }
        }
      } catch {
        // Ignore invalid selectors.
      }
    }

    return false;
  };
  const readCartCount = () => {
    for (const selector of cartBadgeSelectors) {
      try {
        const nodes = Array.from(document.querySelectorAll(selector));
        for (const node of nodes) {
          const text = normalizeText(node.textContent);
          const match = text.match(/\d+/);
          if (match) return Number.parseInt(match[0], 10);
        }
      } catch {
        // Ignore invalid selectors.
      }
    }
    return null;
  };
  const getSuccessMatch = () => {
    for (const selector of successSelectors) {
      try {
        const nodes = Array.from(document.querySelectorAll(selector));
        for (const node of nodes) {
          if (!isVisible(node)) continue;
          const text = getElementText(node);
          const classText = normalizeText(`${node.className || ''} ${node.id || ''}`);
          if (classText.includes('success')) {
            return { method: 'success_selector', text };
          }
          if (matchesAny(text, successTextPatterns) && strongSuccess.some((token) => text.includes(token.toLowerCase()))) {
            return { method: 'success_text', text };
          }
        }
      } catch {
        // Ignore invalid selectors.
      }
    }
    return null;
  };

  if (matchesAny(bodyText, securityTextPatterns)) {
    return { status: 'security_check' };
  }

  if (hasVisibleLoginGate()) {
    return { status: 'login_required' };
  }

  if (matchesAny(bodyText, failureTextPatterns)) {
    return { status: 'blocked' };
  }

  const currentCartCount = readCartCount();
  if (
    Number.isFinite(clickResult?.cartCountBefore) &&
    Number.isFinite(currentCartCount) &&
    currentCartCount > clickResult.cartCountBefore
  ) {
    clickVisibleConfirm();
    return { status: 'confirmed', reason: 'cart_count_increase' };
  }

  const successMatch = getSuccessMatch();
  if (successMatch) {
    clickVisibleConfirm();
    return { status: 'confirmed', reason: successMatch.method };
  }

  return { status: 'waiting' };
}

async function waitForAgentPageReady(tabId, config) {
  let lastResult = { status: 'not_ready' };

  for (let attempt = 0; attempt < 15; attempt++) {
    await sleep(attempt === 0 ? 2500 : 1500);
    const result = await runScriptInTab(tabId, inspectAgentCheckoutPage, [config]);
    if (result?.status) {
      lastResult = result;
    }

    if (lastResult.status === 'ready') {
      return lastResult;
    }
  }

  return lastResult;
}

async function waitForCheckoutVerification(tabId, config, clickResult) {
  let lastResult = { status: 'waiting' };

  for (let attempt = 0; attempt < 12; attempt++) {
    await sleep(750);
    const result = await runScriptInTab(tabId, verifyAgentCheckoutState, [config, clickResult]);
    if (result?.status) {
      lastResult = result;
    }

    if (lastResult.status !== 'waiting') {
      return lastResult;
    }
  }

  return { status: 'unconfirmed' };
}

async function handleAgentCheckoutTab(agentId, tabUrl) {
  const tab = await chrome.tabs.create({ url: tabUrl, active: false });

  if (agentId === 'raw') {
    return { success: true, tabId: tab.id, clicked: false, confirmed: false, reason: 'opened' };
  }

  const config = AGENT_CHECKOUT_CONFIG[agentId] || getAgentCheckoutConfig(agentId);
  if (!config) {
    return { success: false, tabId: tab.id, clicked: false, confirmed: false, reason: 'unknown_agent' };
  }

  await waitForTabComplete(tab.id);

  const readyState = await waitForAgentPageReady(tab.id, config);
  if (readyState.status !== 'ready') {
    return {
      success: true,
      tabId: tab.id,
      clicked: false,
      confirmed: false,
      reason: readyState.status === 'not_ready' ? 'unconfirmed' : readyState.status
    };
  }

  const clickResult = await runScriptInTab(tab.id, clickAgentAddToCart, [config]) || { status: 'script_failed' };
  if (clickResult.status !== 'clicked') {
    return {
      success: true,
      tabId: tab.id,
      clicked: false,
      confirmed: false,
      reason: clickResult.status === 'script_failed' ? 'unconfirmed' : clickResult.status
    };
  }

  const verification = await waitForCheckoutVerification(tab.id, config, clickResult);
  if (verification.status === 'confirmed') {
    await sleep(500);
    try {
      await chrome.tabs.remove(tab.id);
    } catch {
      // Tab may already be closed by the site.
    }

    return {
      success: true,
      tabId: tab.id,
      clicked: true,
      confirmed: true,
      reason: verification.reason || 'confirmed'
    };
  }

  return {
    success: true,
    tabId: tab.id,
    clicked: true,
    confirmed: false,
    reason: verification.status || 'unconfirmed'
  };
}

// ── Taobao AU free shipping finder ───────────────────────────
// Opens Taobao listings in a background tab (so the user's own Taobao
// login and delivery address apply), looks for the "境外满包邮" tag and
// caches the answer per item, per Taobao shop and per Yupoo vendor.
const AU_MAX_ITEMS_PER_CHECK = 3;
const AU_MAX_ALBUM_FETCHES = 12;
const AU_ALBUM_FETCH_CONCURRENCY = 4;
const AU_PAGE_LOAD_MS = 20000;           // per Taobao page, unless waiting for the user
const AU_SCRIPT_TIMEOUT_MS = 8000;       // per read of a Taobao page
const AU_USER_WAIT_MS = 3 * 60 * 1000;   // time to log in or pass the slider
const AU_BLOCK_CONFIRM_POLLS = 3;        // ~3s before a login page counts
let auCheckChain = Promise.resolve();
let auActiveRun = null;                  // { activity, handedToUser, startedAt } for the running check

// A check can't survive a service worker restart, so drop any progress
// line one left behind.
if (AuFreeShip) chrome.storage.local.remove(AuFreeShip.ACTIVITY_KEY).catch(() => {});

// One check at a time: each one drives a Taobao tab, and opening several
// Taobao pages at once makes its verification slider more likely.
function enqueueAuCheck(task) {
  const run = auCheckChain.then(task);
  auCheckChain = run.catch(() => {});
  return run;
}

async function getAuResults() {
  const result = await chrome.storage.local.get(AuFreeShip.STORAGE_KEY);
  return AuFreeShip.normalizeResults(result[AuFreeShip.STORAGE_KEY]);
}

async function updateAuResults(mutate) {
  const results = await getAuResults();
  mutate(results);
  await chrome.storage.local.set({ [AuFreeShip.STORAGE_KEY]: results });
}

async function isAuFreeShipReady() {
  if (!AuFreeShip) return false;
  const settings = await getSettings();
  if (settings[AuFreeShip.SETTING_KEY] !== true) return false;
  return chrome.permissions.contains({ origins: [...AuFreeShip.OPTIONAL_ORIGINS] });
}

// The wiki script can only be registered once reddit access is granted,
// so it is added and removed here instead of in the manifest.
async function syncAuWikiScript() {
  if (!AuFreeShip) return;
  try {
    const wanted = await isAuFreeShipReady();
    const { id, matches, js, css } = AuFreeShip.WIKI_SCRIPT;
    const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
    if (wanted && !registered.length) {
      await chrome.scripting.registerContentScripts([
        { id, matches: [...matches], js: [...js], css: [...css], runAt: 'document_idle' }
      ]);
    } else if (!wanted && registered.length) {
      await chrome.scripting.unregisterContentScripts({ ids: [id] });
    }
  } catch (error) {
    console.warn('[YuCart BG] Failed to sync wiki script:', error?.message || error);
  }
}

// Runs inside the Taobao tab. Uses the main world so it can read the
// page's own data (g_config / __ICE_APP_CONTEXT__) for the shop identity.
function inspectTaobaoPage(config) {
  const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const digits = (value) => (/^\d{4,}$/.test(String(value ?? '').trim()) ? String(value).trim() : '');
  const isVisible = (element) => !!(element && element.getClientRects().length);
  const escapeRe = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const skipTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
  const siteChrome = 'header, nav, footer, #J_SiteNav, #J_SiteFooter, [class*="site-nav" i], [class*="siteNav" i], [class*="footer" i]';
  const titleArea = 'h1, #J_Title, .tb-main-title, [class*="mainTitle" i], [class*="itemTitle" i]';
  const labelRes = config.labelPatterns.map((pattern) => new RegExp(pattern.source, pattern.flags));
  const auRe = new RegExp(config.auContextPatterns.map(escapeRe).join('|'), 'i');
  const reserved = new Set(config.reservedSubdomains);

  const url = new URL(location.href);
  const host = url.hostname.toLowerCase();
  const bodyText = normalize(document.body?.innerText);
  const lowerText = bodyText.toLowerCase();
  const hasAny = (patterns) => patterns.some((pattern) => lowerText.includes(String(pattern).toLowerCase()));
  const matchLabel = (text) => {
    for (const re of labelRes) {
      const match = text.match(re);
      if (match) return match[0];
    }
    return '';
  };

  // Climb a few levels from each text node so tags split across spans
  // (满<b>249</b>包邮) still match. Site navigation is skipped, and so are
  // long titles, where sellers sometimes write their own shipping claims.
  const findLabel = () => {
    if (!document.body || !matchLabel(bodyText)) return null;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || skipTags.has(parent.tagName) || !/包邮|shipping/i.test(node.data)) continue;
      for (let element = parent, depth = 0; element && depth < 4; element = element.parentElement, depth++) {
        const text = normalize(element.textContent);
        if (text.length > 200) break;
        const matched = matchLabel(text);
        if (!matched) continue;
        if (isVisible(element) && !element.closest(siteChrome) && !(text.length > 40 && element.closest(titleArea))) {
          return { matched, text: text.slice(0, 80) };
        }
        break;
      }
    }
    return null;
  };

  // The tag only shows when Taobao is delivering to Australia, so a missing
  // tag means nothing unless the page shows an Australian destination.
  const hasAuDelivery = () => {
    if (!document.body) return false;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || skipTags.has(parent.tagName) || !auRe.test(node.data)) continue;
      if (isVisible(parent) && !parent.closest(siteChrome)) return true;
    }
    return false;
  };

  const identity = { shopId: '', sellerId: '', storeHost: '', shopName: '' };
  const absorb = (source) => {
    if (!source || typeof source !== 'object') return;
    identity.shopId ||= digits(source.shopId);
    identity.sellerId ||= digits(source.sellerId ?? source.userId);
    if (!identity.shopName && typeof source.shopName === 'string') identity.shopName = normalize(source.shopName).slice(0, 60);
  };
  try { absorb(window.g_config); } catch { /* not an older detail page */ }
  try {
    // The item's own seller sits nearer the root than recommended items,
    // so search breadth-first.
    const queue = [[window.__ICE_APP_CONTEXT__, 0]];
    for (let index = 0; index < queue.length && index < 4000 && !identity.shopId; index++) {
      const [value, depth] = queue[index];
      if (!value || typeof value !== 'object' || depth > 8) continue;
      if (value.seller && typeof value.seller === 'object') absorb(value.seller);
      if (queue.length < 20000) {
        for (const key of Object.keys(value)) queue.push([value[key], depth + 1]);
      }
    }
  } catch { /* not a newer detail page */ }

  const shopAnchors = Array.from(document.querySelectorAll('[class*="shop" i] a[href], a[href][class*="shop" i]'));
  for (const anchor of shopAnchors) {
    const href = anchor.href || '';
    identity.shopId ||= digits(href.match(/\/\/shop(\d+)\.(?:m\.)?taobao\.com/i)?.[1]);
    identity.sellerId ||= digits(href.match(/[?&]user_number_id=(\d+)/i)?.[1]);
    const store = href.toLowerCase().match(/^https?:\/\/([a-z0-9-]+)\.(taobao|tmall)\.com(?:[/?#]|$)/);
    if (!identity.storeHost && store && !reserved.has(store[1]) && !/^shop\d+$/.test(store[1])) {
      identity.storeHost = `${store[1]}.${store[2]}.com`;
    }
  }
  // On a shop page the page itself is the shop.
  const ownShopId = digits(host.match(/^shop(\d+)\.(?:m\.)?taobao\.com$/)?.[1]);
  const ownSubdomain = host.replace(/\.(?:taobao|tmall)\.com$/, '');
  if (ownShopId) {
    identity.shopId = ownShopId;
  } else if (ownSubdomain !== host && !ownSubdomain.includes('.') && !reserved.has(ownSubdomain)) {
    identity.storeHost = host;
  }

  const isItemPage = /^(?:[a-z]+\.)?(?:item|detail)\./.test(host) || /\/item\//.test(url.pathname);
  const itemId = isItemPage
    ? digits(url.searchParams.get('id')) || digits(url.pathname.match(/\/item\/(\d+)\.htm/)?.[1])
    : '';
  const itemIds = [];
  if (!itemId) {
    for (const anchor of document.querySelectorAll('a[href*="id="]')) {
      const id = digits((anchor.href || '').match(/(?:item\.taobao\.com|detail\.tmall\.com)\/item\.htm\?(?:[^#]*&)?id=(\d+)/i)?.[1]);
      if (id && !itemIds.includes(id)) itemIds.push(id);
      if (itemIds.length >= 12) break;
    }
  }

  const label = findLabel();

  // Only a login form the user can actually see counts. Taobao refreshes
  // sessions through blank pages on login.taobao.com, and keeps hidden or
  // off-screen login frames around on normal pages.
  const isOnScreen = (element) => {
    if (element.checkVisibility && !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 100 && rect.height > 100 && rect.right > 0 && rect.bottom > 0 &&
      rect.left < window.innerWidth && rect.top < window.innerHeight;
  };
  const login = /^(?:login|passport)\./.test(host)
    ? hasAny(config.loginPatterns) || Array.from(document.querySelectorAll('input[type="password"]')).some(isVisible)
    : Array.from(document.querySelectorAll('iframe[src*="login."], iframe[src*="passport."]')).some(isOnScreen);

  return {
    url: location.href,
    itemId,
    itemIds,
    identity,
    label,
    ready: bodyText.length > 200 && /[¥￥]\s*\d/.test(bodyText),
    auDelivery: !!label || hasAuDelivery(),
    security: /_____tmd_____|\/punish/i.test(location.href) || hasAny(config.securityPatterns),
    login,
    unavailable: hasAny(config.unavailablePatterns)
  };
}

function auStatusFromPage(page) {
  if (!page) return 'error';
  if (page.label) return 'eligible';
  if (page.security) return 'security_check';
  if (page.login) return 'login_required';
  if (page.unavailable) return 'unavailable';
  if (!page.ready) return 'error';
  return page.auDelivery ? 'not_found' : 'region_unknown';
}

// Bring the check tab to the front when Taobao needs the user (login or slider).
async function handAuTabToUser(tabId) {
  if (auActiveRun) auActiveRun.handedToUser = true;
  const tab = await chrome.tabs.update(tabId, { active: true }).catch(() => null);
  if (tab) chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
}

// Share what the running check is doing with Yupoo and wiki pages, and log
// it so a slow check can be traced in the service worker console.
async function reportAu(update) {
  if (!auActiveRun) return;
  const previous = auActiveRun.activity;
  const next = { ...previous, ...update };
  if (next.step === previous.step && next.waiting === previous.waiting) return;
  auActiveRun.activity = next;
  const seconds = ((Date.now() - auActiveRun.startedAt) / 1000).toFixed(1);
  console.info(`[YuCart AU] ${next.target}: ${next.waiting || next.step} (${seconds}s)`);
  await chrome.storage.local.set({ [AuFreeShip.ACTIVITY_KEY]: next });
}

// Read the Taobao tab as it is, without waiting for it to finish loading:
// heavy pages in a background tab can take a long time to reach "complete",
// and Chrome can freeze a hidden tab, so each read has a time limit.
function readTaobaoTab(tabId) {
  const injection = chrome.scripting.executeScript({
    target: { tabId },
    func: inspectTaobaoPage,
    args: [AuFreeShip.inspectConfig()],
    world: 'MAIN',
    injectImmediately: true
  }).then((results) => results?.[0]?.result ?? null, () => null);
  return Promise.race([injection, sleep(AU_SCRIPT_TIMEOUT_MS).then(() => null)]);
}

// Load a URL in the check tab and poll until the tag shows up, the page is
// clearly blocked, or it has rendered for a few polls without the tag. If
// Taobao asks for a login or its slider, the tab is brought to the front and
// the check waits for the user, then carries on.
async function loadAndInspectTaobao(tabId, url, { itemId = '', wantItems = false } = {}) {
  const previousUrl = (await chrome.tabs.get(tabId).catch(() => null))?.url || '';
  await chrome.tabs.update(tabId, { url });

  let page = null;
  let deadline = Date.now() + AU_PAGE_LOAD_MS;
  let settledPolls = 0;
  let blockedPolls = 0;
  let waitedForUser = false;
  let reopenedListing = false;
  while (Date.now() < deadline) {
    await sleep(1000);
    // The user closed the tab instead of logging in.
    if (!(await chrome.tabs.get(tabId).catch(() => null))) break;
    const result = await readTaobaoTab(tabId);
    // Still the page from before the navigation.
    if (!result || (result.url === previousUrl && previousUrl !== url)) continue;
    page = result;

    // Taobao passes through login.taobao.com for a moment when it refreshes
    // a session, so a login or slider only counts once it has stayed put.
    if (page.security || page.login) {
      settledPolls = 0;
      if (++blockedPolls >= AU_BLOCK_CONFIRM_POLLS) {
        if (!waitedForUser) {
          waitedForUser = true;
          deadline = Date.now() + AU_USER_WAIT_MS;
          await handAuTabToUser(tabId);
        }
        await reportAu({ waiting: page.security ? 'waiting_security' : 'waiting_login' });
      }
      continue;
    }
    blockedPolls = 0;
    await reportAu({ waiting: null });

    if (itemId && page.itemId !== itemId) {
      // After logging in Taobao can land on its home page; go back once.
      if (waitedForUser && !reopenedListing && page.ready) {
        reopenedListing = true;
        await chrome.tabs.update(tabId, { url });
      }
      // Otherwise this is the previous page or a redirect to another listing.
      continue;
    }
    if (page.label || page.unavailable) return page;
    const settled = wantItems ? page.itemIds.length > 0 : page.ready;
    if (settled && ++settledPolls >= 3) return page;
  }
  console.info(`[YuCart AU] ${url} did not settle in time; last seen ${page ? `${page.url} (ready: ${page.ready})` : 'nothing readable'}`);
  return page;
}

async function checkTaobaoItemInTab(tabId, itemId) {
  const page = await loadAndInspectTaobao(tabId, AuFreeShip.itemUrl(itemId), { itemId });
  let status = auStatusFromPage(page);
  if (page && page.itemId !== itemId && !['security_check', 'login_required'].includes(status)) {
    status = 'error';
  }
  console.info(`[YuCart AU] listing ${itemId}: ${status}${page?.label ? ` ("${page.label.matched}")` : ''}`);
  return {
    status,
    itemId,
    matched: page?.label?.matched || '',
    identity: page?.identity || null
  };
}

// The page a Taobao login URL will return to, e.g. the redirectURL in
// login.taobao.com/member/login.jhtml?redirectURL=<listing>.
function loginRedirectTarget(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!/^(?:login|passport)\./.test(url.hostname)) return '';
    for (const key of ['redirectURL', 'redirect_url', 'redirect', 'target', 'goto', 'return_url', 'returnUrl']) {
      let value = url.searchParams.get(key) || '';
      if (/^https?%3A/i.test(value)) value = decodeURIComponent(value);
      if (value) return value;
    }
  } catch {
    // Not a URL.
  }
  return '';
}

// Short links (m.tb.cn) only reveal the item or shop once they redirect.
async function resolveTaobaoShortLink(tabId, shortUrl) {
  await reportAu({ step: 'following the share link' });
  await chrome.tabs.update(tabId, { url: shortUrl });
  let lastUrl = '';
  for (let attempt = 0; attempt < 15; attempt++) {
    await sleep(800);
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return { status: 'error' };
    lastUrl = tab.pendingUrl || tab.url || '';
    // A login page still names the listing it came from, so check that
    // listing. If Taobao really needs a login, the listing check waits for it.
    const link = AuFreeShip.parseTaobaoLink(loginRedirectTarget(lastUrl) || lastUrl);
    if (link && link.type !== 'short') return { link };
  }
  return { status: /^https?:\/\/(?:login|passport)\./i.test(lastUrl) ? 'login_required' : 'error' };
}

// Most informative outcome of several item checks: any tagged item means the
// seller is in the program; a blocker means the rest could not be checked.
function summarizeAuChecks(checks) {
  const eligible = checks.find((check) => check.status === 'eligible');
  if (eligible) return eligible;
  const blocked = checks.find((check) => AuFreeShip.BLOCKING_STATUSES.includes(check.status));
  if (blocked) return { status: blocked.status };
  const notFound = checks.filter((check) => check.status === 'not_found');
  if (notFound.length) return { ...notFound[0], checkedItems: notFound.length };
  return { status: checks.length ? checks[checks.length - 1].status : 'no_links' };
}

function auRecord(check, now) {
  return {
    status: check.status,
    matched: check.matched || '',
    itemId: check.itemId || '',
    shopKeys: AuFreeShip.shopKeys(check.identity),
    shopName: check.identity?.shopName || '',
    checkedItems: check.checkedItems || (check.itemId ? 1 : 0),
    checkedAt: now
  };
}

// A single tagged item proves the shop takes part; a single untagged one
// only fills in shops nobody has checked yet.
function recordAuItem(results, check, now) {
  if (!check.itemId || !AuFreeShip.STORED_STATUSES.includes(check.status)) return;
  const record = auRecord(check, now);
  results.items[check.itemId] = record;
  for (const key of record.shopKeys) {
    if (check.status === 'eligible' || !results.shops[key]) {
      results.shops[key] = record;
    }
  }
}

function recordAuVendor(results, vendor, check, now, { replaceEligible = true } = {}) {
  if (!vendor || !AuFreeShip.STORED_STATUSES.includes(check.status)) return;
  const existing = results.vendors[vendor];
  if (!replaceEligible && existing?.status === 'eligible' && check.status !== 'eligible') return;
  results.vendors[vendor] = auRecord(check, now);
}

async function checkTaobaoShopInTab(tabId, link) {
  const shopHost = link.shopId ? `shop${link.shopId}.taobao.com` : link.storeHost;
  const pageUrls = [link.url];
  if (shopHost) pageUrls.push(`https://${shopHost}/search.htm`);

  // Shop home pages sometimes lazy-load their items; the search page lists them.
  let page = null;
  for (const [index, pageUrl] of pageUrls.entries()) {
    await reportAu({ step: index === 0 ? 'opening the Taobao shop' : 'opening the shop\'s item list' });
    page = await loadAndInspectTaobao(tabId, pageUrl, { wantItems: true });
    if (!page || page.label || page.security || page.login || page.itemIds.length) break;
  }

  const identity = {
    shopId: link.shopId || page?.identity?.shopId || '',
    sellerId: link.sellerId || page?.identity?.sellerId || '',
    storeHost: link.storeHost || page?.identity?.storeHost || '',
    shopName: page?.identity?.shopName || ''
  };
  if (page?.security) return { status: 'security_check' };
  if (page?.login) return { status: 'login_required' };

  const itemChecks = [];
  let outcome;
  if (page?.label) {
    outcome = { status: 'eligible', matched: page.label.matched };
  } else {
    const itemIds = (page?.itemIds || []).slice(0, AU_MAX_ITEMS_PER_CHECK);
    for (const [index, itemId] of itemIds.entries()) {
      await reportAu({ step: `checking shop listing ${index + 1} of ${itemIds.length}` });
      const check = await checkTaobaoItemInTab(tabId, itemId);
      itemChecks.push(check);
      if (check.status === 'eligible' || AuFreeShip.BLOCKING_STATUSES.includes(check.status)) break;
    }
    outcome = itemChecks.length ? summarizeAuChecks(itemChecks) : { status: page ? 'no_links' : 'error' };
  }

  const now = Date.now();
  await updateAuResults((results) => {
    for (const check of itemChecks) recordAuItem(results, check, now);
    // An explicit shop check replaces whatever was inferred from single items.
    if (outcome.status === 'eligible' || outcome.status === 'not_found') {
      const record = auRecord({ ...outcome, identity }, now);
      for (const key of record.shopKeys) results.shops[key] = record;
    }
  });
  return { ...outcome, identity };
}

async function checkTaobaoTargetInTab(tabId, rawUrl, vendor = '') {
  let link = AuFreeShip.parseTaobaoLink(rawUrl);
  if (!link) return { status: 'no_links' };

  let shortUrl = '';
  if (link.type === 'short') {
    shortUrl = link.url;
    const resolved = await resolveTaobaoShortLink(tabId, shortUrl);
    if (!resolved.link) return { status: resolved.status };
    link = resolved.link;
  }

  if (link.type === 'shop') {
    const outcome = await checkTaobaoShopInTab(tabId, link);
    if (vendor) {
      await updateAuResults((results) => recordAuVendor(results, vendor, outcome, Date.now(), { replaceEligible: false }));
    }
    return outcome;
  }

  const check = await checkTaobaoItemInTab(tabId, link.itemId);
  const now = Date.now();
  await updateAuResults((results) => {
    recordAuItem(results, check, now);
    if (shortUrl && AuFreeShip.STORED_STATUSES.includes(check.status)) {
      results.shortLinks[shortUrl] = link.itemId;
    }
    if (vendor) recordAuVendor(results, vendor, check, now, { replaceEligible: false });
  });
  return check;
}

// Album URLs come from the page DOM, so only fetch the vendor's own albums.
function sanitizeVendorAlbumUrls(vendor, albumUrls) {
  const urls = new Map();
  for (const raw of Array.isArray(albumUrls) ? albumUrls : []) {
    try {
      const url = new URL(raw);
      const albumId = url.pathname.match(/^\/albums\/(\d+)/)?.[1];
      if (url.protocol === 'https:' && albumId && AuFreeShip.parseYupooVendor(url.href) === vendor && !urls.has(albumId)) {
        urls.set(albumId, url.href);
      }
    } catch {
      // Ignore malformed URLs.
    }
  }
  return [...urls.values()];
}

async function fetchYupooAlbumUrls(vendor) {
  const origin = `https://${vendor}.x.yupoo.com`;
  try {
    const html = await fetchTextWithTimeout(`${origin}/albums`);
    const urls = new Map();
    for (const match of html.matchAll(/href=["'](\/albums\/(\d+)[^"']*)["']/g)) {
      if (!urls.has(match[2])) urls.set(match[2], origin + match[1].replace(/&amp;/g, '&'));
      if (urls.size >= AU_MAX_ALBUM_FETCHES) break;
    }
    return [...urls.values()];
  } catch {
    return [];
  }
}

// Find a few Taobao listings for a Yupoo vendor from their album subtitles.
async function collectVendorTaobaoLinks(vendor, productUrls, albumUrls) {
  const taobaoLinks = [];
  let otherLinks = 0;
  const add = (text) => {
    const taobaoLink = AuFreeShip.extractTaobaoLink(text);
    if (taobaoLink) {
      if (!taobaoLinks.includes(taobaoLink)) taobaoLinks.push(taobaoLink);
    } else if (/weidian\.com|1688\.com/i.test(text || '')) {
      otherLinks++;
    }
  };

  (Array.isArray(productUrls) ? productUrls : []).forEach(add);
  let albums = sanitizeVendorAlbumUrls(vendor, albumUrls);
  if (!albums.length) {
    await reportAu({ step: 'reading the Yupoo album list' });
    albums = await fetchYupooAlbumUrls(vendor);
  }
  albums = albums.slice(0, AU_MAX_ALBUM_FETCHES);
  // A few albums at a time, in order, until enough Taobao links turn up.
  for (let start = 0; start < albums.length && taobaoLinks.length < AU_MAX_ITEMS_PER_CHECK; start += AU_ALBUM_FETCH_CONCURRENCY) {
    const group = albums.slice(start, start + AU_ALBUM_FETCH_CONCURRENCY);
    await reportAu({ step: `reading Yupoo albums (${start + group.length} of ${albums.length})` });
    // Albums that fail to load are skipped.
    const links = await Promise.all(group.map((albumUrl) => fetchAlbumProductLink(albumUrl).catch(() => '')));
    links.forEach(add);
  }
  return { taobaoLinks, otherLinks };
}

async function checkYupooVendorInTab(tabId, vendor, productUrls, albumUrls) {
  const { taobaoLinks, otherLinks } = await collectVendorTaobaoLinks(vendor, productUrls, albumUrls);
  let outcome;
  if (!taobaoLinks.length) {
    outcome = { status: otherLinks ? 'not_taobao' : 'no_links' };
  } else {
    const checks = [];
    const links = taobaoLinks.slice(0, AU_MAX_ITEMS_PER_CHECK);
    for (const [index, link] of links.entries()) {
      await reportAu({ step: `checking Taobao listing ${index + 1} of ${links.length}` });
      const check = await checkTaobaoTargetInTab(tabId, link);
      checks.push(check);
      if (check.status === 'eligible' || AuFreeShip.BLOCKING_STATUSES.includes(check.status)) break;
    }
    outcome = summarizeAuChecks(checks);
  }
  await updateAuResults((results) => recordAuVendor(results, vendor, outcome, Date.now()));
  return outcome;
}

// A short name for what's being checked, for the progress line and logs.
function auTargetLabel(target, vendor) {
  if (target.kind === 'yupoo') return `${vendor} (Yupoo)`;
  const link = AuFreeShip.parseTaobaoLink(target.url);
  if (link.type === 'item') return `Taobao listing ${link.itemId}`;
  if (link.type === 'shop') return link.shopId ? `shop${link.shopId}.taobao.com` : link.storeHost || `Taobao seller ${link.sellerId}`;
  return 'Taobao share link';
}

// target: { kind: 'taobao', url, vendor? } or { kind: 'yupoo', vendor, productUrls?, albumUrls? }
// openerTabId: the tab the check was started from, to return to afterwards.
async function runAuFreeShipCheck(target, openerTabId = null) {
  if (!(await isAuFreeShipReady())) return { status: 'permission_required' };

  const vendor = /^[a-z0-9-]{1,64}$/.test(String(target?.vendor || '')) ? target.vendor : '';
  if (target?.kind === 'yupoo' && !vendor) return { status: 'no_links' };
  if (target?.kind !== 'yupoo' && !AuFreeShip.parseTaobaoLink(target?.url)) return { status: 'no_links' };

  const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
  auActiveRun = {
    activity: { target: auTargetLabel(target, vendor), step: '', waiting: null },
    handedToUser: false,
    startedAt: Date.now()
  };
  await reportAu({ step: target.kind === 'yupoo' ? 'starting' : 'opening the Taobao page' });
  let outcome = { status: 'error' };
  try {
    outcome = target.kind === 'yupoo'
      ? await checkYupooVendorInTab(tab.id, vendor, target.productUrls, target.albumUrls)
      : await checkTaobaoTargetInTab(tab.id, target.url, vendor);
    return outcome;
  } finally {
    const { activity, handedToUser, startedAt } = auActiveRun;
    auActiveRun = null;
    await chrome.storage.local.remove(AuFreeShip.ACTIVITY_KEY);
    console.info(`[YuCart AU] ${activity.target}: ${outcome.status} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    if (outcome.status === 'login_required' || outcome.status === 'security_check') {
      // Leave Taobao in front when the user still has to log in or pass the slider.
      chrome.tabs.update(tab.id, { active: true }).catch(() => {});
      chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    } else {
      chrome.tabs.remove(tab.id).catch(() => {});
      // The user was sent to Taobao mid-check; take them back where they were.
      if (handedToUser && openerTabId) chrome.tabs.update(openerTabId, { active: true }).catch(() => {});
    }
  }
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
  syncAuWikiScript();
});

chrome.runtime.onInstalled.addListener(async () => {
  const cart = await getCart();
  updateBadge(cart);
  const settings = await getSettings();
  await fetchExchangeRate(settings.targetCurrency);
  await updateImageRules();
  checkForUpdates();
  scheduleUpdateAlarm();
  syncAuWikiScript();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes[SETTINGS_KEY]) {
    syncAuWikiScript();
  }
});
chrome.permissions.onAdded.addListener(() => syncAuWikiScript());
chrome.permissions.onRemoved.addListener(() => syncAuWikiScript());

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
        case 'uploadCleanedNames': {
          if (msg.data) {
            try {
              // Hardcoded Firebase Firestore REST API configuration
              const PROJECT_ID = 'yucart-extension';
              const API_KEY = 'AIzaSyB99EE4fClAhFlqrZk3G7nlLizIH1vXojg';
              const COLLECTION = 'cleaned_names';

              const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${COLLECTION}?key=${API_KEY}`;

              const payload = {
                fields: {
                  originalName: { stringValue: msg.data.originalName || 'Unknown' },
                  cleanedName: { stringValue: msg.data.cleanedName || 'Unknown' },
                  storeLink: { stringValue: msg.data.storeLink || '' },
                  productLink: { stringValue: msg.data.productLink || '' },
                  vendor: { stringValue: msg.data.vendor || 'Unknown' },
                  color: msg.data.color ? { stringValue: msg.data.color } : { nullValue: null },
                  itemType: msg.data.itemType ? { stringValue: msg.data.itemType } : { nullValue: null },
                  timestamp: { timestampValue: new Date(msg.data.timestamp || Date.now()).toISOString() }
                }
              };

              const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
              });

              if (!resp.ok) {
                const errorData = await resp.json().catch(() => ({}));
                console.error('[YuCart BG] Firestore upload failed:', errorData);
                sendResponse({ success: false, error: 'Firestore API Error: ' + (errorData.error?.message || resp.statusText) });
              } else {
                sendResponse({ success: true });
              }
            } catch (e) {
              console.error('[YuCart BG] Firebase upload failed:', e);
              sendResponse({ success: false, error: e.message });
            }
          } else {
            sendResponse({ success: false, error: 'No data provided' });
          }
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
        case 'getWardrobe': {
          if (!(await isWardrobeBetaEnabled())) {
            sendResponse({ wardrobe: [], disabled: true });
            break;
          }
          const wardrobe = await getWardrobe();
          sendResponse({ wardrobe });
          break;
        }
        case 'addToWardrobe': {
          if (!(await isWardrobeBetaEnabled())) {
            sendResponse({ success: false, error: 'wardrobe_beta_disabled' });
            break;
          }
          const wardrobe = await addToWardrobe(msg.item);
          sendResponse({ success: true, wardrobe });
          break;
        }
        case 'removeFromWardrobe': {
          if (!(await isWardrobeBetaEnabled())) {
            sendResponse({ success: false, error: 'wardrobe_beta_disabled' });
            break;
          }
          const wardrobe = await removeFromWardrobe(msg.itemId);
          sendResponse({ success: true, wardrobe });
          break;
        }
        case 'clearWardrobe': {
          if (!(await isWardrobeBetaEnabled())) {
            sendResponse({ success: false, error: 'wardrobe_beta_disabled' });
            break;
          }
          const wardrobe = await clearWardrobe();
          sendResponse({ success: true, wardrobe });
          break;
        }
        case 'getOutfits': {
          if (!(await isWardrobeBetaEnabled())) {
            sendResponse({ outfits: [], disabled: true });
            break;
          }
          const outfits = await getOutfits();
          sendResponse({ outfits });
          break;
        }
        case 'saveOutfit': {
          if (!(await isWardrobeBetaEnabled())) {
            sendResponse({ success: false, error: 'wardrobe_beta_disabled' });
            break;
          }
          const outfits = await saveOutfitToStorage(msg.outfit);
          sendResponse({ success: true, outfits });
          break;
        }
        case 'deleteOutfit': {
          if (!(await isWardrobeBetaEnabled())) {
            sendResponse({ success: false, error: 'wardrobe_beta_disabled' });
            break;
          }
          const outfits = await deleteOutfit(msg.outfitId);
          sendResponse({ success: true, outfits });
          break;
        }
        case 'auFreeShipCheck': {
          if (!AuFreeShip) {
            sendResponse({ status: 'error' });
            break;
          }
          const outcome = await enqueueAuCheck(() => runAuFreeShipCheck(msg.target, sender.tab?.id ?? null));
          sendResponse(outcome);
          break;
        }
        case 'agentCheckoutTab': {
          try {
            const response = await handleAgentCheckoutTab(msg.agentId, msg.url);
            sendResponse(response);
          } catch (tabErr) {
            console.error('[YuCart BG] Failed to open tab:', tabErr);
            sendResponse({ success: false, error: tabErr.message });
          }
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
