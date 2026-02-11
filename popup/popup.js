/* ============================================================
   YuCart — Popup Logic
   Cart display, vendor grouping, currency conversion
   ============================================================ */

document.addEventListener('DOMContentLoaded', init);

let cart = [];
let settings = {};
let rateData = null;

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

    // Load rate
    const rateResp = await chrome.runtime.sendMessage({ action: 'getRate', currency: settings.targetCurrency });
    rateData = rateResp?.rateData || null;
    updateRateBar();

    // Refresh DNR rules (injects cookies for image loading)
    await chrome.runtime.sendMessage({ action: 'prepareImages' });

    // Load cart
    const cartResp = await chrome.runtime.sendMessage({ action: 'getCart' });
    cart = cartResp?.cart || [];
    render();

    // Event listeners
    document.getElementById('clearBtn').addEventListener('click', handleClear);
    document.getElementById('exportBtn').addEventListener('click', handleExport);
    document.getElementById('settingsLink').addEventListener('click', (e) => {
        e.preventDefault();
        chrome.runtime.openOptionsPage();
    });
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

    return `
    <div class="cart-item" data-id="${item.id}">
      ${thumbHtml}
      <div class="cart-item__info">
        <div class="cart-item__title">
          ${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</a>` : escapeHtml(item.title)}
        </div>
        <div class="cart-item__price">
          ¥${item.price.toFixed(2)} × ${item.quantity}
          ${convertedStr ? `<span class="cart-item__price-converted">${convertedStr}</span>` : ''}
        </div>
      </div>
      <div class="cart-item__controls">
        <button class="qty-btn" data-action="decrement" data-id="${item.id}">−</button>
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
            text += `  • ${item.title}\n`;
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
    let toast = document.querySelector('.copied-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.className = 'copied-toast';
        toast.textContent = '✓ Copied to clipboard';
        document.body.appendChild(toast);
    }
    requestAnimationFrame(() => toast.classList.add('copied-toast--visible'));
    setTimeout(() => {
        toast.classList.remove('copied-toast--visible');
    }, 1800);
}

// ── Helpers ──────────────────────────────────────────────────
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
