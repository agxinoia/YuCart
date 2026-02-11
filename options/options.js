/* ============================================================
   YuCart — Options Page Logic
   ============================================================ */

const SETTINGS_KEY = 'yucart_settings';

document.addEventListener('DOMContentLoaded', init);

async function init() {
    // Load settings
    const result = await chrome.storage.sync.get(SETTINGS_KEY);
    const settings = result[SETTINGS_KEY] || { targetCurrency: 'USD', darkMode: true };

    // Set currency dropdown
    const currencySelect = document.getElementById('currency');
    currencySelect.value = settings.targetCurrency || 'USD';

    // Set dark mode checkbox
    const darkModeCheckbox = document.getElementById('darkMode');
    darkModeCheckbox.checked = settings.darkMode !== false; // default true

    // Set AI provider and API key
    const providerSelect = document.getElementById('aiProvider');
    const apiKeyInput = document.getElementById('aiApiKey');
    providerSelect.value = settings.aiProvider || 'openai';
    if (settings.aiApiKey) {
        apiKeyInput.value = settings.aiApiKey;
    }

    // Load current rate
    loadRate(settings.targetCurrency);

    // Event listeners
    document.getElementById('saveBtn').addEventListener('click', save);
    document.getElementById('refreshRate').addEventListener('click', refreshRate);
    currencySelect.addEventListener('change', () => {
        loadRate(currencySelect.value);
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
        targetCurrency: document.getElementById('currency').value,
        darkMode: document.getElementById('darkMode').checked,
        aiProvider: document.getElementById('aiProvider').value,
        // Only update API key if user entered something (preserve existing if empty)
        aiApiKey: apiKey || existingSettings.aiApiKey || ''
    };

    await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });

    // Show saved status
    const status = document.getElementById('saveStatus');
    status.textContent = '✓ Saved';
    status.classList.add('save-status--visible');
    setTimeout(() => status.classList.remove('save-status--visible'), 2000);
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
