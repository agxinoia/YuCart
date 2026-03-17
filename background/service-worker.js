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

const RATE_CACHE_KEY = 'yucart_exchange_rate';
const RATE_TTL = 6 * 60 * 60 * 1000; // 6 hours
const CART_KEY = 'yucart_cart';
const WARDROBE_KEY = 'yucart_wardrobe';
const OUTFITS_KEY = 'yucart_outfits';
const SETTINGS_KEY = 'yucart_settings';
const DNR_RULE_ID = 1;
const {
  AGENT_CHECKOUT_CONFIG = {},
  getAgentCheckoutConfig = () => null
} = globalThis.YuCartAgentCheckout || {};

const DEFAULT_SETTINGS = {
  targetCurrency: 'USD',
  darkMode: true,  // Dark mode enabled by default
  betaWardrobeEnabled: false,
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

  // If no subtitle (product source link), try to scrape it from the Yupoo detail page
  const target = existing || cart[cart.length - 1];
  if (!target.subtitle && target.url && target.url.includes('yupoo.com')) {
    scrapeSubtitle(target.id, target.url);
  }

  return cart;
}

// Fetch a Yupoo album page and extract the product source link from the subtitle
async function scrapeSubtitle(itemId, albumUrl) {
  try {
    const resp = await fetch(albumUrl, { credentials: 'omit' });
    if (!resp.ok) return;
    const html = await resp.text();

    // Parse the gallerysubtitle anchor's href
    // Pattern: <a ... href="...external?url=ENCODED_URL..."...> inside gallerysubtitle
    const subtitleMatch = html.match(
      /gallerysubtitle[\s\S]*?<a[^>]+href=["']([^"']+)["']/i
    );
    if (!subtitleMatch) return;

    const href = subtitleMatch[1];
    let productUrl = '';

    // Unwrap Yupoo redirect: /external?url=<encoded>
    const urlParam = href.match(/[?&]url=([^&]+)/);
    if (urlParam) {
      try {
        productUrl = decodeURIComponent(decodeURIComponent(urlParam[1]));
      } catch {
        productUrl = decodeURIComponent(urlParam[1]);
      }
    } else {
      productUrl = href;
    }

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

// Remove.bg API Key
const REMOVE_BG_API_KEY = 'DPTNpTyCv42yzSCResFgoirD';

// ── Remove.bg API ───────────────────────────────────────────────
async function removeBackground(imageUrl) {
  try {
    const formData = new FormData();
    formData.append('image_url', imageUrl);
    formData.append('size', 'auto');
    formData.append('format', 'png');

    const response = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: {
        'X-Api-Key': REMOVE_BG_API_KEY
      },
      body: formData
    });

    if (!response.ok) {
      console.error('[YuCart] Remove.bg API error:', response.status);
      return null;
    }

    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.error('[YuCart] Remove.bg failed:', err);
    return null;
  }
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
  const result = await chrome.storage.sync.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) };
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

async function runScriptInTab(tabId, func, args = []) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func,
      args
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
                  originalName: { stringValue: msg.data.originalName || "Unknown" },
                  cleanedName: { stringValue: msg.data.cleanedName || "Unknown" },
                  storeLink: { stringValue: msg.data.storeLink || "" },
                  productLink: { stringValue: msg.data.productLink || "" },
                  vendor: { stringValue: msg.data.vendor || "Unknown" },
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
