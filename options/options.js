/* ============================================================
   YuCart — Options Page Logic
   ============================================================ */

const SETTINGS_KEY = 'yucart_settings';
const LOCAL_SETTINGS_KEY = 'yucart_local_settings';
const DEFAULT_POPUP_SCALE = 1;
const POPUP_SCALE_MIN = 0.8;
const POPUP_SCALE_MAX = 1.25;
const AuFreeShip = globalThis.YuCartAuFreeShip || null;
const SUPPORT_AFFILIATE_LINKS = {
    superbuy: {
        name: 'Superbuy',
        registerUrl: 'https://www.superbuy.com/en/page/login?partnercode=Eb6pHI&type=register',
        note: 'Automatic checkout adds partner code Eb6pHI.'
    },
    allchinabuy: {
        name: 'AllChinaBuy',
        registerUrl: 'https://www.allchinabuy.com/en/page/login?partnercode=Eb65dD&type=register',
        note: 'Automatic checkout adds partner code Eb65dD.'
    },
    kakobuy: {
        name: 'KakoBuy',
        registerUrl: 'https://ikako.vip/r/yucart',
        note: 'Automatic checkout appends affcode=yucart.'
    },
    sugargoo: {
        name: 'Sugargoo',
        registerUrl: 'https://www.sugargoo.com/register?memberId=3161294460426724183',
        note: 'Automatic checkout adds memberId 3161294460426724183.'
    },
    acbuy: {
        name: 'ACBuy',
        registerUrl: 'https://www.acbuy.com/login?loginStatus=register&code=K9ZLJF',
        note: 'Automatic checkout uses your ACBuy code K9ZLJF.'
    },
    mulebuy: {
        name: 'Mulebuy',
        registerUrl: 'https://mulebuy.com/register?ref=201039387',
        note: 'Automatic checkout uses your Mulebuy ref 201039387.'
    },
    oopbuy: {
        name: 'OOPBUY',
        registerUrl: 'https://oopbuy.com/register?inviteCode=SEZRCZCLM',
        note: 'Automatic checkout uses your OOPBUY invite code SEZRCZCLM.'
    }
};

document.addEventListener('DOMContentLoaded', init);

function normalizePopupScale(value) {
    const numeric = Number.parseFloat(value);
    if (!Number.isFinite(numeric)) return DEFAULT_POPUP_SCALE;
    return Math.min(POPUP_SCALE_MAX, Math.max(POPUP_SCALE_MIN, Math.round(numeric * 100) / 100));
}

function popupScaleToPercent(value) {
    return Math.round(normalizePopupScale(value) * 100);
}

function updatePopupScaleValue(percent) {
    const scaleValue = document.getElementById('popupScaleValue');
    if (scaleValue) {
        scaleValue.textContent = `${percent}%`;
    }
}

async function init() {
    // Load settings
    const [syncResult, localResult] = await Promise.all([
        chrome.storage.sync.get(SETTINGS_KEY),
        chrome.storage.local.get(LOCAL_SETTINGS_KEY)
    ]);
    const settings = {
        targetCurrency: 'USD',
        darkMode: true,
        betaWardrobeEnabled: false,
        betaAutoCheckoutEnabled: false,
        betaAuFreeShipEnabled: false,
        popupScale: DEFAULT_POPUP_SCALE,
        ...(syncResult[SETTINGS_KEY] || {}),
        ...(localResult[LOCAL_SETTINGS_KEY] || {})
    };

    // Set currency dropdown
    const currencySelect = document.getElementById('currency');
    currencySelect.value = settings.targetCurrency || 'USD';

    // Set agent dropdown
    const agentSelect = document.getElementById('selectedAgent');
    agentSelect.value = settings.selectedAgent || 'superbuy';

    // Set popup scale
    const popupScaleInput = document.getElementById('popupScale');
    const popupScalePercent = popupScaleToPercent(settings.popupScale);
    popupScaleInput.value = String(popupScalePercent);
    updatePopupScaleValue(popupScalePercent);

    // Set dark mode checkbox
    const darkModeCheckbox = document.getElementById('darkMode');
    darkModeCheckbox.checked = settings.darkMode !== false; // default true

    // Set beta wardrobe toggle
    const betaWardrobeCheckbox = document.getElementById('betaWardrobeEnabled');
    betaWardrobeCheckbox.checked = settings.betaWardrobeEnabled === true;
    const betaAutoCheckoutCheckbox = document.getElementById('betaAutoCheckoutEnabled');
    if (betaAutoCheckoutCheckbox) {
        betaAutoCheckoutCheckbox.checked = settings.betaAutoCheckoutEnabled === true;
    }
    await initAuFreeShip(settings.betaAuFreeShipEnabled === true);

    // Set AI provider and API key
    const providerSelect = document.getElementById('aiProvider');
    const apiKeyInput = document.getElementById('aiApiKey');
    providerSelect.value = settings.aiProvider || 'openai';
    if (settings.aiApiKey) {
        apiKeyInput.value = settings.aiApiKey;
    }
    renderSupportAffiliateLink(agentSelect.value);

    // Load current rate
    loadRate(settings.targetCurrency);

    // Event listeners
    document.getElementById('saveBtn').addEventListener('click', save);
    document.getElementById('refreshRate').addEventListener('click', refreshRate);
    currencySelect.addEventListener('change', () => {
        loadRate(currencySelect.value);
    });
    agentSelect.addEventListener('change', () => {
        renderSupportAffiliateLink(agentSelect.value);
    });
    popupScaleInput.addEventListener('input', () => {
        updatePopupScaleValue(Number(popupScaleInput.value));
    });
}

async function loadRate(currency) {
    const rateEl = document.getElementById('currentRate');
    const timeEl = document.getElementById('rateTime');

    try {
        const resp = await chrome.runtime.sendMessage({ action: 'getRate', currency });
        if (resp?.rateData) {
            rateEl.textContent = `¥1 CNY = ${resp.rateData.rate.toFixed(4)} ${currency}`;
            const ago = timeSince(resp.rateData.fetchedAt);
            timeEl.textContent = `Updated ${ago}`;
        } else {
            rateEl.textContent = 'Not yet fetched';
            timeEl.textContent = '';
        }
    } catch (e) {
        rateEl.textContent = 'Error loading rate';
        timeEl.textContent = '';
    }
}

async function refreshRate() {
    const currency = document.getElementById('currency').value;
    const rateEl = document.getElementById('currentRate');
    const timeEl = document.getElementById('rateTime');

    rateEl.textContent = 'Refreshing...';
    timeEl.textContent = '';

    try {
        const resp = await chrome.runtime.sendMessage({ action: 'refreshRate', currency });
        if (resp?.rateData) {
            rateEl.textContent = `¥1 CNY = ${resp.rateData.rate.toFixed(4)} ${currency}`;
            timeEl.textContent = 'Updated just now';
        } else {
            rateEl.textContent = 'Failed to refresh';
        }
    } catch (e) {
        rateEl.textContent = 'Error refreshing';
    }
}

async function save() {
    const [syncResult, localResult] = await Promise.all([
        chrome.storage.sync.get(SETTINGS_KEY),
        chrome.storage.local.get(LOCAL_SETTINGS_KEY)
    ]);
    const existingSettings = syncResult[SETTINGS_KEY] || {};
    const existingLocalSettings = localResult[LOCAL_SETTINGS_KEY] || {};

    const apiKeyInput = document.getElementById('aiApiKey');
    const apiKey = apiKeyInput.value.trim();

    const settings = {
        ...existingSettings,
        targetCurrency: document.getElementById('currency').value,
        selectedAgent: document.getElementById('selectedAgent').value,
        popupScale: normalizePopupScale(Number(document.getElementById('popupScale').value) / 100),
        darkMode: document.getElementById('darkMode').checked,
        betaWardrobeEnabled: document.getElementById('betaWardrobeEnabled').checked,
        betaAutoCheckoutEnabled: document.getElementById('betaAutoCheckoutEnabled') ? document.getElementById('betaAutoCheckoutEnabled').checked : false,
        betaAuFreeShipEnabled: document.getElementById('betaAuFreeShipEnabled').checked,
        aiProvider: document.getElementById('aiProvider').value
    };

    delete settings.aiApiKey;

    const localSettings = {
        ...existingLocalSettings,
        aiApiKey: apiKey || existingLocalSettings.aiApiKey || existingSettings.aiApiKey || ''
    };

    await Promise.all([
        chrome.storage.sync.set({ [SETTINGS_KEY]: settings }),
        chrome.storage.local.set({ [LOCAL_SETTINGS_KEY]: localSettings })
    ]);

    // Show saved status
    const status = document.getElementById('saveStatus');
    status.textContent = '✓ Saved';
    status.classList.add('save-status--visible');
    setTimeout(() => status.classList.remove('save-status--visible'), 2000);
}

// ── Taobao AU Free Shipping Finder ───────────────────────────
async function initAuFreeShip(enabled) {
    const toggle = document.getElementById('betaAuFreeShipEnabled');
    if (!AuFreeShip) {
        toggle.disabled = true;
        return;
    }

    const granted = await chrome.permissions.contains({ origins: [...AuFreeShip.OPTIONAL_ORIGINS] });
    toggle.checked = enabled && granted;
    if (enabled && !granted) {
        showAuHint('Taobao/Reddit access was removed. Switch this on again to re-grant it, then save.');
    }

    toggle.addEventListener('change', handleAuToggle);
    document.getElementById('clearAuResults').addEventListener('click', clearAuResults);
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes[AuFreeShip.STORAGE_KEY]) {
            renderAuResults(changes[AuFreeShip.STORAGE_KEY].newValue);
        }
    });

    const stored = await chrome.storage.local.get([AuFreeShip.STORAGE_KEY, AuFreeShip.LOG_KEY]);
    renderAuResults(stored[AuFreeShip.STORAGE_KEY]);
    initAuLog(enabled && granted, stored[AuFreeShip.LOG_KEY]);
}

// ── Free shipping finder debug log ───────────────────────────
function initAuLog(enabled, lines) {
    const card = document.getElementById('auLogCard');
    const textarea = document.getElementById('auLog');
    const render = (value) => {
        const log = Array.isArray(value) ? value : [];
        // Keep following new lines unless the user has scrolled up to read.
        const atBottom = textarea.scrollTop + textarea.clientHeight >= textarea.scrollHeight - 20;
        textarea.value = log.length ? log.join('\n') : 'No checks yet. Start one from a Yupoo page or the wiki.';
        if (atBottom) textarea.scrollTop = textarea.scrollHeight;
        card.hidden = !enabled && !log.length;
    };
    render(lines);
    textarea.scrollTop = textarea.scrollHeight;

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes[AuFreeShip.LOG_KEY]) render(changes[AuFreeShip.LOG_KEY].newValue);
    });
    document.getElementById('copyAuLog').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(textarea.value);
            flashAuLogStatus('✓ Copied');
        } catch {
            textarea.focus();
            textarea.select();
            flashAuLogStatus('Press Ctrl+C (⌘C) to copy');
        }
    });
    document.getElementById('clearAuLog').addEventListener('click', async () => {
        await chrome.storage.local.remove(AuFreeShip.LOG_KEY);
        flashAuLogStatus('✓ Cleared');
    });

    // The wiki panel's "Debug log" button opens settings at #au-log.
    if (location.hash === '#au-log') {
        card.hidden = false;
        card.scrollIntoView({ block: 'start' });
    }
}

function flashAuLogStatus(text) {
    const status = document.getElementById('auLogStatus');
    status.textContent = text;
    status.classList.add('save-status--visible');
    setTimeout(() => status.classList.remove('save-status--visible'), 2000);
}

async function handleAuToggle(event) {
    const toggle = event.target;
    showAuHint('');
    if (!toggle.checked) return;

    // Request before any other await: Chrome only allows it during the click.
    let granted = false;
    try {
        granted = await chrome.permissions.request({ origins: [...AuFreeShip.OPTIONAL_ORIGINS] });
    } catch (error) {
        console.warn('[YuCart] Permission request failed:', error);
    }
    if (!granted) {
        toggle.checked = false;
        showAuHint('YuCart needs Taobao and Reddit access to check listings.');
        return;
    }
    showAuHint('Access granted. Click Save Settings to turn it on.');
}

function showAuHint(text) {
    const hint = document.getElementById('auFreeShipHint');
    hint.textContent = text;
    hint.hidden = !text;
}

function parseAuShopKey(key) {
    const separator = key.indexOf(':');
    return { type: key.slice(0, separator), value: key.slice(separator + 1) };
}

function auShopUrl(key) {
    const { type, value } = parseAuShopKey(key);
    if (type === 'shop') return `https://shop${value}.taobao.com/`;
    if (type === 'host') return `https://${value}/`;
    if (type === 'seller') return `https://store.taobao.com/shop/view_shop.htm?user_number_id=${value}`;
    return '';
}

function auShopLabel(key) {
    const { type, value } = parseAuShopKey(key);
    if (type === 'shop') return `shop${value}.taobao.com`;
    if (type === 'host') return value;
    return `Taobao seller ${value}`;
}

// Shops are stored under every key they can be looked up by; list each once.
function uniqueAuShops(shops) {
    const unique = new Map();
    for (const [key, record] of Object.entries(shops)) {
        const id = record.shopKeys?.[0] || key;
        if (!unique.has(id)) unique.set(id, { key: id, record });
    }
    return [...unique.values()];
}

function renderAuResults(value) {
    const results = AuFreeShip.normalizeResults(value);
    const vendors = Object.entries(results.vendors);
    const shops = uniqueAuShops(results.shops);
    const itemCount = Object.keys(results.items).length;
    document.getElementById('auResultsCard').hidden = !vendors.length && !shops.length && !itemCount;

    const rows = [];
    for (const [vendor, record] of vendors) {
        if (record.status !== 'eligible') continue;
        const shop = record.shopName ? ` · Taobao shop ${record.shopName}` : '';
        rows.push(auResultRow(vendor, `https://${vendor}.x.yupoo.com/albums`, `Yupoo seller${shop}`, record));
    }
    for (const { key, record } of shops) {
        if (record.status !== 'eligible') continue;
        rows.push(auResultRow(record.shopName || auShopLabel(key), auShopUrl(key), 'Taobao shop', record));
    }

    document.getElementById('auResultsSummary').textContent =
        `${rows.length} of ${vendors.length + shops.length} sellers checked ship free to Australia on ¥${AuFreeShip.THRESHOLD_CNY}+ orders (${itemCount} Taobao listings checked).`;
    document.getElementById('auResultsList').innerHTML = rows.length
        ? rows.join('')
        : '<p class="au-results__empty">No sellers with the tag yet. Check sellers from a Yupoo store or the r/FashionReps wiki.</p>';
}

function auResultRow(name, url, kind, record) {
    const checked = record.checkedAt ? new Date(record.checkedAt).toLocaleDateString() : '';
    const matched = record.matched ? ` · "${record.matched}"` : '';
    return `
        <div class="au-results__row">
            <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="au-results__name">${escapeHtml(name)}</a>
            <span class="au-results__meta">${escapeHtml(`${kind}${matched}${checked ? ` · checked ${checked}` : ''}`)}</span>
        </div>
    `;
}

async function clearAuResults() {
    if (!confirm('Clear all Taobao AU free shipping results?')) return;
    await chrome.storage.local.remove(AuFreeShip.STORAGE_KEY);
}

function renderSupportAffiliateLink(agentId) {
    const grid = document.getElementById('affiliateGrid');
    if (!grid) return;
    const entry = SUPPORT_AFFILIATE_LINKS[agentId];

    if (!entry) {
        grid.innerHTML = `
            <div class="affiliate-card">
                <div class="affiliate-card__header">
                    <div>
                        <h3 class="affiliate-card__title">Raw Link</h3>
                        <p class="affiliate-card__status">Raw Link mode does not have an affiliate registration page.</p>
                    </div>
                </div>
                <button class="affiliate-link-btn affiliate-link-btn--disabled" type="button" disabled>Open Raw Link registration</button>
            </div>
        `;
        return;
    }

    grid.innerHTML = `
        <div class="affiliate-card">
            <div class="affiliate-card__header">
                <div>
                    <h3 class="affiliate-card__title">${escapeHtml(entry.name)}</h3>
                    <p class="affiliate-card__status">${escapeHtml(entry.note)}</p>
                </div>
            </div>
            <a href="${escapeHtml(entry.registerUrl)}" class="affiliate-link-btn" target="_blank" rel="noopener noreferrer">Open ${escapeHtml(entry.name)} registration</a>
        </div>
    `;
}

const _escapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const _escapeRe = /[&<>"']/g;

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(_escapeRe, c => _escapeMap[c]);
}

function timeSince(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}
