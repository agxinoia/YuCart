/* ============================================================
   YuCart — Popup Logic
   Cart display, vendor grouping, currency conversion, AI name cleaning
   ============================================================ */

document.addEventListener('DOMContentLoaded', init);

let cart = [];
let settings = {};
let rateData = null;
let aiProvider = 'openai';
let aiApiKey = '';
const GEMINI_MAX_ITEMS_PER_BATCH = 20;
const GEMINI_MAX_IMAGE_DIMENSION = 320;
const GEMINI_IMAGE_QUALITY = 0.72;

const CURRENCY_SYMBOLS = {
    USD: '$', EUR: '€', GBP: '£', AUD: 'A$', CAD: 'C$',
    JPY: '¥', KRW: '₩', INR: '₹', RUB: '₽', BRL: 'R$',
    MXN: 'MX$', CHF: 'Fr', SEK: 'kr', NOK: 'kr', DKK: 'kr',
    PLN: 'zł', TRY: '₺', THB: '฿', PHP: '₱', MYR: 'RM',
    SGD: 'S$', HKD: 'HK$', TWD: 'NT$', NZD: 'NZ$', ZAR: 'R'
};

function currencySymbol(code) {
    return CURRENCY_SYMBOLS[code] || code + ' ';
}

function convertPrice(cny) {
    if (!rateData?.rate) return null;
    return cny * rateData.rate;
}

function formatConverted(cny) {
    const val = convertPrice(cny);
    if (val === null) return '';
    return `≈ ${currencySymbol(settings.targetCurrency || 'USD')}${val.toFixed(2)}`;
}

// ── Init ─────────────────────────────────────────────────────
async function init() {
    // Load settings
    const settingsResp = await chrome.runtime.sendMessage({ action: 'getSettings' });
    settings = settingsResp?.settings || { targetCurrency: 'USD' };
    aiProvider = settings.aiProvider || 'openai';
    aiApiKey = settings.aiApiKey || '';

    // Load rate
    const rateResp = await chrome.runtime.sendMessage({ action: 'getRate', currency: settings.targetCurrency });
    rateData = rateResp?.rateData || null;
    updateRateBar();

    // Load cart
    const cartResp = await chrome.runtime.sendMessage({ action: 'getCart' });
    cart = cartResp?.cart || [];
    render();

    // Check for updates
    await checkAndShowUpdateNotification();

    // Show/hide AI buttons based on API key
    const cleanAllBtn = document.getElementById('cleanAllBtn');
    const resetNamesBtn = document.getElementById('resetNamesBtn');
    if (cleanAllBtn) {
        cleanAllBtn.style.display = aiApiKey ? 'inline-flex' : 'none';
    }
    if (resetNamesBtn) {
        resetNamesBtn.style.display = aiApiKey ? 'inline-flex' : 'none';
    }

    // Event listeners
    document.getElementById('clearBtn').addEventListener('click', handleClear);
    document.getElementById('exportBtn').addEventListener('click', handleExport);
    document.getElementById('settingsLink').addEventListener('click', (e) => {
        e.preventDefault();
        chrome.runtime.openOptionsPage();
    });
    if (cleanAllBtn) {
        cleanAllBtn.addEventListener('click', handleCleanAll);
    }
    if (resetNamesBtn) {
        resetNamesBtn.addEventListener('click', handleResetNames);
    }
}

// ── Rate Bar ─────────────────────────────────────────────────
function updateRateBar() {
    const el = document.getElementById('rateValue');
    if (rateData?.rate) {
        const target = settings.targetCurrency || 'USD';
        el.textContent = `¥1 = ${currencySymbol(target)}${rateData.rate.toFixed(4)}`;
    } else {
        el.textContent = 'Unavailable';
    }
}

// ── Update Notification ──────────────────────────────────────
async function checkAndShowUpdateNotification() {
    const resp = await chrome.runtime.sendMessage({ action: 'getUpdateInfo' });
    const updateInfo = resp?.updateInfo;

    if (updateInfo?.updateAvailable && !updateInfo.dismissed) {
        showUpdateBanner(updateInfo);
    }
}

function showUpdateBanner(updateInfo) {
    // Remove any existing banner
    const existingBanner = document.querySelector('.update-banner');
    if (existingBanner) existingBanner.remove();

    const banner = document.createElement('div');
    banner.className = 'update-banner';
    banner.innerHTML = `
        <div class="update-banner__content">
            <div class="update-banner__icon">🎉</div>
            <div class="update-banner__text">
                <strong class="update-banner__title">Update Available: v${escapeHtml(updateInfo.latestVersion)}</strong>
                <p class="update-banner__message">${escapeHtml(updateInfo.updateMessage)}</p>
            </div>
            <div class="update-banner__actions">
                <a href="${escapeHtml(updateInfo.releaseUrl)}" target="_blank" class="update-banner__btn update-banner__btn--primary">
                    View Update
                </a>
                <button id="dismissUpdateBtn" class="update-banner__btn update-banner__btn--ghost">
                    Dismiss
                </button>
            </div>
        </div>
    `;

    // Insert after header
    const header = document.querySelector('.header');
    header.after(banner);

    // Bind dismiss handler
    document.getElementById('dismissUpdateBtn').addEventListener('click', async () => {
        await chrome.runtime.sendMessage({ action: 'dismissUpdate' });
        banner.classList.add('update-banner--dismissing');
        setTimeout(() => banner.remove(), 300);
    });
}

// ── Render ───────────────────────────────────────────────────
function render() {
    const emptyState = document.getElementById('emptyState');
    const vendorGroupsEl = document.getElementById('vendorGroups');
    const footer = document.getElementById('footer');
    const itemCount = document.getElementById('itemCount');

    const totalItems = cart.reduce((s, i) => s + i.quantity, 0);
    itemCount.textContent = `${totalItems} item${totalItems !== 1 ? 's' : ''}`;

    if (cart.length === 0) {
        emptyState.style.display = 'flex';
        vendorGroupsEl.innerHTML = '';
        footer.style.display = 'none';
        return;
    }

    emptyState.style.display = 'none';
    footer.style.display = 'block';

    // Group by vendor
    const groups = {};
    for (const item of cart) {
        const vendor = item.vendor || 'Unknown';
        if (!groups[vendor]) groups[vendor] = [];
        groups[vendor].push(item);
    }

    let html = '';
    let grandTotal = 0;

    for (const [vendor, items] of Object.entries(groups)) {
        const vendorSubtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
        grandTotal += vendorSubtotal;

        html += `<div class="vendor-group">`;
        html += `<div class="vendor-group__header">`;
        html += `<span class="vendor-group__name">${escapeHtml(vendor)}</span>`;
        html += `<span class="vendor-group__item-count">${items.length} item${items.length !== 1 ? 's' : ''}</span>`;
        html += `</div>`;
        html += `<div class="vendor-group__items">`;

        for (const item of items) {
            html += renderItem(item);
        }

        html += `</div>`;
        html += `<div class="vendor-group__subtotal">`;
        html += `<span>Subtotal</span>`;
        html += `<span class="vendor-group__subtotal-value">¥${vendorSubtotal.toFixed(2)}</span>`;
        html += `</div>`;
        html += `</div>`;
    }

    vendorGroupsEl.innerHTML = html;

    // Totals
    document.getElementById('totalCNY').textContent = `¥${grandTotal.toFixed(2)}`;
    document.getElementById('totalConverted').textContent = formatConverted(grandTotal);

    // Bind events
    bindItemEvents();

    // Init scrolling titles for overflowed text
    initScrollingTitles();

    // Attach image error handlers (can't use inline onerror due to CSP)
    document.querySelectorAll('.cart-item__thumb').forEach(img => {
        img.addEventListener('error', () => {
            const placeholder = document.createElement('div');
            placeholder.className = 'cart-item__thumb--placeholder';
            placeholder.textContent = '📦';
            img.replaceWith(placeholder);
        });
    });
}

function isValidThumbnail(url) {
    if (!url) return false;
    // Skip 1x1 placeholder data URIs
    if (url.startsWith('data:') && url.length < 200) return false;
    return true;
}

function renderItem(item) {
    const hasThumb = isValidThumbnail(item.thumbnail);
    const thumbHtml = hasThumb
        ? `<img class="cart-item__thumb" src="${escapeHtml(item.thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
        : `<div class="cart-item__thumb--placeholder">📦</div>`;

    const convertedStr = formatConverted(item.price * item.quantity);
    const isCleaned = item.cleanedTitle && item.cleanedTitle !== item.title;
    const displayTitle = isCleaned ? item.cleanedTitle : item.title;

    return `
    <div class="cart-item" data-id="${item.id}">
      ${thumbHtml}
      <div class="cart-item__info">
        <div class="cart-item__title">
          <span class="cart-item__title-inner">${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" title="${escapeHtml(displayTitle)}">${escapeHtml(displayTitle)}</a>` : escapeHtml(displayTitle)}</span>
        </div>
        <div class="cart-item__price">
          ¥${item.price.toFixed(2)} × ${item.quantity}
          ${convertedStr ? `<span class="cart-item__price-converted">${convertedStr}</span>` : ''}
        </div>
      </div>
      <div class="cart-item__controls">
        <button class="qty-btn" data-action="decrement" data-id="${item.id}" style="${item.quantity <= 1 ? 'display:none' : ''}">−</button>
        <span class="qty-value">${item.quantity}</span>
        <button class="qty-btn" data-action="increment" data-id="${item.id}">+</button>
        <button class="remove-btn" data-action="remove" data-id="${item.id}" title="Remove">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    </div>
  `;
}

function bindItemEvents() {
    document.querySelectorAll('.qty-btn, .remove-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = btn.dataset.id;
            const action = btn.dataset.action;

            if (action === 'remove') {
                const resp = await chrome.runtime.sendMessage({ action: 'removeFromCart', itemId: id });
                cart = resp?.cart || [];
                render();
            } else if (action === 'increment') {
                const item = cart.find(i => i.id === id);
                if (item) {
                    const resp = await chrome.runtime.sendMessage({ action: 'updateQuantity', itemId: id, quantity: item.quantity + 1 });
                    cart = resp?.cart || [];
                    render();
                }
            } else if (action === 'decrement') {
                const item = cart.find(i => i.id === id);
                if (item && item.quantity > 1) {
                    const resp = await chrome.runtime.sendMessage({ action: 'updateQuantity', itemId: id, quantity: item.quantity - 1 });
                    cart = resp?.cart || [];
                    render();
                }
            }
        });
    });
}

// ── Reset Cleaned Names ──────────────────────────────────────
async function handleResetNames() {
    const hasCleaned = cart.some(item => item.cleanedTitle);
    if (!hasCleaned) {
        showToast('No cleaned names to reset');
        return;
    }
    const resp = await chrome.runtime.sendMessage({ action: 'resetCleanedNames' });
    cart = resp?.cart || [];
    render();
    showToast('Names reset to original');
}

// ── AI Name Cleaning (Batch) ─────────────────────────────────
async function handleCleanAll() {
    if (!aiApiKey) {
        showToast('Please add your API key in Settings');
        return;
    }

    // Filter to items that haven't been cleaned yet
    const itemsToClean = cart.filter(item => !item.cleanedTitle);
    if (itemsToClean.length === 0) {
        showToast('All items already cleaned');
        return;
    }

    let batchItems = itemsToClean;
    if (aiProvider === 'gemini' && itemsToClean.length > GEMINI_MAX_ITEMS_PER_BATCH) {
        batchItems = itemsToClean.slice(0, GEMINI_MAX_ITEMS_PER_BATCH);
        showToast(`Gemini batch limit: cleaning first ${GEMINI_MAX_ITEMS_PER_BATCH} items`);
    }

    const cleanAllBtn = document.getElementById('cleanAllBtn');
    const loadingBar = document.getElementById('aiLoadingBar');
    cleanAllBtn.classList.add('btn--star--loading');
    cleanAllBtn.disabled = true;
    loadingBar.classList.add('ai-loading-bar--active');

    // Track which IDs we're about to clean
    const cleaningIds = new Set(batchItems.map(i => i.id));

    // Apply blur loading effect to items being cleaned
    cleaningIds.forEach(id => {
        const el = document.querySelector(`.cart-item[data-id="${id}"] .cart-item__title`);
        if (el) {
            el.classList.add('cart-item__title--loading');
        }
    });

    try {
        // Build JSON payload with cart info (include thumbnail for Gemini vision)
        const cartData = batchItems.map(item => ({
            id: item.id,
            name: item.title,
            link: item.url || '',
            vendor: item.vendor || '',
            thumbnail: item.thumbnail || '',
            subtitle: item.subtitle || ''
        }));

        const results = await callAIBatch(cartData);

        const updates = [];
        for (const result of results) {
            if (result.id && result.cleaned_name) {
                updates.push({
                    itemId: result.id,
                    cleanedTitle: result.cleaned_name
                });
            }
        }

        // Persist all updates in one background message.
        let cleanedCount = 0;
        if (updates.length > 0) {
            const updateResp = await chrome.runtime.sendMessage({
                action: 'updateItemTitlesBatch',
                updates
            });
            cart = updateResp?.cart || [];
            cleanedCount = updates.length;
        } else {
            const cartResp = await chrome.runtime.sendMessage({ action: 'getCart' });
            cart = cartResp?.cart || [];
        }

        render();

        // Unblur freshly cleaned items
        cleaningIds.forEach(id => {
            const el = document.querySelector(`.cart-item[data-id="${id}"] .cart-item__title`);
            if (el) {
                el.classList.remove('cart-item__title--loading');
                el.classList.add('cart-item__title--unblur');
                el.addEventListener('animationend', () => {
                    el.classList.remove('cart-item__title--unblur');
                }, { once: true });
            }
        });

        if (cleanedCount > 0) {
            showToast(`Cleaned ${cleanedCount} item${cleanedCount !== 1 ? 's' : ''}`);
        } else {
            showToast('Failed to clean items');
        }
    } catch (err) {
        console.error('AI batch cleaning failed:', err);
        showToast('Failed: ' + (err.message || 'Unknown error'));
    } finally {
        loadingBar.classList.remove('ai-loading-bar--active');
        cleanAllBtn.classList.remove('btn--star--loading');
        cleanAllBtn.disabled = false;
    }
}

function buildBatchPrompt(cartData) {
    const cartJson = JSON.stringify(cartData, null, 2);
    return `Here are products from a Yupoo shopping cart:\n\n${cartJson}\n\nRules:\n- Clean each product name to a readable description (5 words max)\n- Remove all codes, model numbers, random characters, and seller jargon\n- Use the link, vendor, and especially the subtitle (which often contains the real product source URL like Weidian or Taobao) as context clues for what the product is\n- If the name is just a code with no real product info, use the subtitle link, vendor name and guess the product type (e.g. "Nike Sneakers", "Designer Bag")\n- Never include codes or numbers in the cleaned name\n\nRespond with ONLY a JSON array, no markdown, no explanation:\n[{"id":"<same id>","cleaned_name":"<cleaned name>"}]`;
}

async function callAIBatch(cartData) {
    const prompt = buildBatchPrompt(cartData);

    switch (aiProvider) {
        case 'openrouter':
            return await callOpenRouterBatch(prompt, cartData);
        case 'gemini':
            return await callGeminiBatch(prompt, cartData);
        case 'openai':
        default:
            return await callOpenAIBatch(prompt, cartData);
    }
}

function parseAIJsonResponse(text) {
    // Strip markdown code fences if present
    text = text.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '');

    // Find the JSON array by matching balanced brackets
    const start = text.indexOf('[');
    if (start === -1) throw new Error('No JSON array in AI response');

    let depth = 0;
    let end = -1;
    for (let i = start; i < text.length; i++) {
        if (text[i] === '[') depth++;
        else if (text[i] === ']') {
            depth--;
            if (depth === 0) { end = i + 1; break; }
        }
    }
    if (end === -1) throw new Error('Malformed JSON array in AI response');

    const jsonStr = text.substring(start, end);

    try {
        const parsed = JSON.parse(jsonStr);
        if (!Array.isArray(parsed)) throw new Error('Response is not an array');
        // Sanitize each result - ensure cleaned_name is a plain string, max 5 words
        return parsed.map(item => ({
            id: String(item.id || ''),
            cleaned_name: String(item.cleaned_name || '').replace(/[<>"'&]/g, '').trim()
        })).filter(item => item.id && item.cleaned_name);
    } catch (e) {
        // Try to fix common JSON issues: trailing commas, single quotes
        const fixed = jsonStr
            .replace(/,\s*([}\]])/g, '$1')    // trailing commas
            .replace(/'/g, '"');                // single quotes
        const parsed = JSON.parse(fixed);
        if (!Array.isArray(parsed)) throw new Error('Response is not an array');
        return parsed.map(item => ({
            id: String(item.id || ''),
            cleaned_name: String(item.cleaned_name || '').replace(/[<>"'&]/g, '').trim()
        })).filter(item => item.id && item.cleaned_name);
    }
}

async function callOpenAIBatch(prompt, cartData) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${aiApiKey}`
        },
        body: JSON.stringify({
            model: 'gpt-3.5-turbo',
            messages: [
                { role: 'system', content: 'You clean up messy e-commerce product names. You always respond with valid JSON only.' },
                { role: 'user', content: prompt }
            ],
            max_tokens: 2000,
            temperature: 0.1
        })
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('No response from AI');
    return parseAIJsonResponse(text);
}

async function callOpenRouterBatch(prompt, cartData) {
    const makeRequest = () => fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${aiApiKey}`,
            'HTTP-Referer': 'https://yupoo.com',
            'X-Title': 'YuCart Extension'
        },
        body: JSON.stringify({
            model: 'z-ai/glm-4.5-air:free',
            messages: [
                { role: 'system', content: 'You clean up messy e-commerce product names. You always respond with valid JSON only. No thinking, no explanation.' },
                { role: 'user', content: prompt }
            ],
            max_tokens: 2000,
            temperature: 0.1
        })
    });

    let response = await makeRequest();

    // Retry on rate limit (429) with backoff
    if (response.status === 429) {
        for (let retry = 1; retry <= 3; retry++) {
            await new Promise(resolve => setTimeout(resolve, retry * 3000));
            response = await makeRequest();
            if (response.status !== 429) break;
        }
    }

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message;
    let text = message?.content?.trim();

    // GLM 4.5 Air sometimes puts output in reasoning field
    if (!text && message?.reasoning) {
        text = message.reasoning;
    }

    if (!text) throw new Error('No response from AI');
    console.log('[YuCart] AI raw response:', text);
    return parseAIJsonResponse(text);
}

function parseDataUrl(dataUrl) {
    const match = /^data:(.*?);base64,(.*)$/.exec(dataUrl || '');
    if (!match) return null;
    return { mimeType: match[1] || 'image/jpeg', base64: match[2] || '' };
}

async function blobToCompressedBase64(blob) {
    try {
        const bitmap = await createImageBitmap(blob);
        const maxEdge = GEMINI_MAX_IMAGE_DIMENSION;
        let width = bitmap.width;
        let height = bitmap.height;

        if (width > maxEdge || height > maxEdge) {
            if (width >= height) {
                height = Math.max(1, Math.round((height * maxEdge) / width));
                width = maxEdge;
            } else {
                width = Math.max(1, Math.round((width * maxEdge) / height));
                height = maxEdge;
            }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) {
            bitmap.close();
            return null;
        }

        ctx.drawImage(bitmap, 0, 0, width, height);
        bitmap.close();

        const dataUrl = canvas.toDataURL('image/jpeg', GEMINI_IMAGE_QUALITY);
        return parseDataUrl(dataUrl);
    } catch {
        return null;
    }
}

async function fetchImageAsBase64(url) {
    try {
        if (!url) return null;

        if (url.startsWith('data:')) {
            return parseDataUrl(url);
        }

        const resp = await fetch(url);
        if (!resp.ok) return null;
        const blob = await resp.blob();

        const compressed = await blobToCompressedBase64(blob);
        if (compressed) return compressed;

        return await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(parseDataUrl(reader.result));
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
        });
    } catch {
        return null;
    }
}

async function callGeminiBatch(prompt, cartData) {
    const limitedCartData = cartData.slice(0, GEMINI_MAX_ITEMS_PER_BATCH);

    // Build multimodal parts: text prompt + product images
    const parts = [];

    parts.push({
        text: `You are identifying products from a Yupoo shopping cart. I will show you each product's current name, link, vendor, and its image.\n\nFor each product, figure out what it actually is by looking at the image and context. Give it a clean, readable name (5 words max). Remove all codes, model numbers, and random characters. Never include codes or numbers in the cleaned name.\n\nRespond with ONLY a JSON array, no markdown fences, no explanation:\n[{"id":"<same id>","cleaned_name":"<cleaned name>"}]`
    });

    // Add each item with its image
    for (const item of limitedCartData) {
        parts.push({
            text: `\n--- Product ---\nID: ${item.id}\nCurrent name: ${item.name}\nVendor: ${item.vendor}\nLink: ${item.link}${item.subtitle ? `\nSubtitle/Source: ${item.subtitle}` : ''}`
        });

        if (item.thumbnail) {
            const imgData = await fetchImageAsBase64(item.thumbnail);
            if (imgData) {
                parts.push({
                    inlineData: {
                        mimeType: imgData.mimeType,
                        data: imgData.base64
                    }
                });
            }
        }
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${aiApiKey}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
                maxOutputTokens: 2000,
                temperature: 0.1
            }
        })
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) throw new Error('No response from AI');
    console.log('[YuCart] Gemini raw response:', text);
    return parseAIJsonResponse(text);
}

// ── Clear Cart ───────────────────────────────────────────────
async function handleClear() {
    if (cart.length === 0) return;
    const resp = await chrome.runtime.sendMessage({ action: 'clearCart' });
    cart = resp?.cart || [];
    render();
}

// ── Export to Clipboard ──────────────────────────────────────
async function handleExport() {
    if (cart.length === 0) return;

    const groups = {};
    for (const item of cart) {
        const vendor = item.vendor || 'Unknown';
        if (!groups[vendor]) groups[vendor] = [];
        groups[vendor].push(item);
    }

    let text = '🛒 YuCart Summary\n';
    text += '═══════════════════════════════\n\n';

    let grandTotal = 0;

    for (const [vendor, items] of Object.entries(groups)) {
        text += `📦 ${vendor}\n`;
        text += '───────────────────────────────\n';

        let vendorTotal = 0;
        for (const item of items) {
            const lineTotal = item.price * item.quantity;
            vendorTotal += lineTotal;
            const displayTitle = item.cleanedTitle || item.title;
            text += `  • ${displayTitle}\n`;
            text += `    ¥${item.price.toFixed(2)} × ${item.quantity} = ¥${lineTotal.toFixed(2)}`;
            const conv = formatConverted(lineTotal);
            if (conv) text += ` ${conv}`;
            text += '\n';
            if (item.url) text += `    ${item.url}\n`;
        }

        grandTotal += vendorTotal;
        text += `  Vendor Total: ¥${vendorTotal.toFixed(2)}\n`;
        text += '\n';
    }
    text += '═══════════════════════════════\n';
    text += `TOTAL: ¥${grandTotal.toFixed(2)}`;
    const conv = formatConverted(grandTotal);
    if (conv) text += ` ${conv}`;
    text += '\n';

    await navigator.clipboard.writeText(text);
    showCopiedToast();
}

function showCopiedToast() {
    showToast('✓ Copied to clipboard');
}

function showToast(message) {
    let toast = document.querySelector('.copied-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.className = 'copied-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    requestAnimationFrame(() => toast.classList.add('copied-toast--visible'));
    setTimeout(() => {
        toast.classList.remove('copied-toast--visible');
    }, 1800);
}

// ── Helpers ──────────────────────────────────────────────────
const _escapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const _escapeRe = /[&<>"']/g;

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(_escapeRe, c => _escapeMap[c]);
}

// ── Scrolling Overflow Titles ────────────────────────────────
function initScrollingTitles() {
    const elements = document.querySelectorAll('.cart-item__title');
    const pairs = []; // collect el + inner pairs for batched processing

    elements.forEach(el => {
        el.classList.remove('cart-item__title--scrolling');
        const inner = el.querySelector('.cart-item__title-inner');
        if (!inner) return;
        inner.style.removeProperty('--scroll-distance');
        inner.style.removeProperty('--scroll-duration');
        inner.style.removeProperty('animation');
        pairs.push({ el, inner });
    });

    if (!pairs.length) return;

    // Batch write: set all to visible in one pass
    requestAnimationFrame(() => {
        pairs.forEach(({ el }) => { el.style.overflow = 'visible'; });

        // Batch read + write in next frame to avoid layout thrashing
        requestAnimationFrame(() => {
            pairs.forEach(({ el, inner }) => {
                const innerWidth = inner.offsetWidth;
                const containerWidth = el.clientWidth;
                el.style.overflow = '';

                const overflow = innerWidth - containerWidth;
                if (overflow > 5) {
                    inner.style.setProperty('--scroll-distance', `-${overflow + 15}px`);
                    const duration = Math.min(8, Math.max(3, overflow / 15));
                    inner.style.setProperty('--scroll-duration', `${duration}s`);
                    el.classList.add('cart-item__title--scrolling');
                }
            });
        });
    });
}
