/* ============================================================
   YuCart — Options Page Logic
   ============================================================ */

const SETTINGS_KEY = 'yucart_settings';
const DEFAULT_POPUP_SCALE = 1;
const POPUP_SCALE_MIN = 0.8;
const POPUP_SCALE_MAX = 1.25;
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
    const result = await chrome.storage.sync.get(SETTINGS_KEY);
    const settings = result[SETTINGS_KEY] || {
        targetCurrency: 'USD',
        darkMode: true,
        betaWardrobeEnabled: false,
        popupScale: DEFAULT_POPUP_SCALE
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
    updateGoogleCalendarVisibility(betaWardrobeCheckbox.checked);

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

    // Check Google Calendar status
    if (betaWardrobeCheckbox.checked) {
        checkGcalStatus();
    }

    // Event listeners
    document.getElementById('saveBtn').addEventListener('click', save);
    document.getElementById('refreshRate').addEventListener('click', refreshRate);
    document.getElementById('gcalSyncBtn').addEventListener('click', syncGoogleCalendar);
    currencySelect.addEventListener('change', () => {
        loadRate(currencySelect.value);
    });
    agentSelect.addEventListener('change', () => {
        renderSupportAffiliateLink(agentSelect.value);
    });
    popupScaleInput.addEventListener('input', () => {
        updatePopupScaleValue(Number(popupScaleInput.value));
    });
    betaWardrobeCheckbox.addEventListener('change', () => {
        updateGoogleCalendarVisibility(betaWardrobeCheckbox.checked);
        if (betaWardrobeCheckbox.checked) {
            checkGcalStatus();
        }
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
    // Load existing settings first to preserve API key if field appears empty (masked)
    const result = await chrome.storage.sync.get(SETTINGS_KEY);
    const existingSettings = result[SETTINGS_KEY] || {};
    
    const apiKeyInput = document.getElementById('aiApiKey');
    const apiKey = apiKeyInput.value.trim();
    
    const settings = {
        ...existingSettings,
        targetCurrency: document.getElementById('currency').value,
        selectedAgent: document.getElementById('selectedAgent').value,
        popupScale: normalizePopupScale(Number(document.getElementById('popupScale').value) / 100),
        darkMode: document.getElementById('darkMode').checked,
        betaWardrobeEnabled: document.getElementById('betaWardrobeEnabled').checked,
        aiProvider: document.getElementById('aiProvider').value,
        aiApiKey: apiKey || existingSettings.aiApiKey || ''
    };

    await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });

    // Show saved status
    const status = document.getElementById('saveStatus');
    status.textContent = '✓ Saved';
    status.classList.add('save-status--visible');
    setTimeout(() => status.classList.remove('save-status--visible'), 2000);
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

// ── Google Calendar ────────────────────────────────────────────
function updateGoogleCalendarVisibility(isEnabled) {
    const section = document.getElementById('googleCalendarSection');
    if (!section) return;
    section.hidden = !isEnabled;
}

function checkGcalStatus() {
    const statusEl = document.getElementById('gcalStatus');
    const btn = document.getElementById('gcalSyncBtn');

    try {
        chrome.identity.getAuthToken({ interactive: false }, (token) => {
            if (chrome.runtime.lastError || !token) {
                statusEl.textContent = 'Not connected';
                statusEl.style.color = '';
                btn.textContent = 'Sync Calendar';
            } else {
                statusEl.textContent = 'Connected';
                statusEl.style.color = '#2ecc71';
                btn.textContent = 'Re-sync';
            }
        });
    } catch {
        statusEl.textContent = 'Not available';
    }
}

async function syncGoogleCalendar() {
    const statusEl = document.getElementById('gcalStatus');
    const btn = document.getElementById('gcalSyncBtn');
    btn.textContent = 'Connecting...';
    btn.disabled = true;

    try {
        const token = await new Promise((resolve, reject) => {
            chrome.identity.getAuthToken({ interactive: true }, (token) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(token);
                }
            });
        });

        statusEl.textContent = 'Connected';
        statusEl.style.color = '#2ecc71';
        btn.textContent = 'Re-sync';
        btn.disabled = false;
    } catch (err) {
        console.error('[YuCart] Google Calendar sync failed:', err);
        statusEl.textContent = 'Failed — try again';
        statusEl.style.color = '#e94560';
        btn.textContent = 'Sync Calendar';
        btn.disabled = false;
    }
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
