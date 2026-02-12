/* ============================================================
   YuCart — Content Script
   Scans Yupoo pages for prices (160Y, ¥160, etc.), injects
   Add-to-Cart buttons on both album listings and detail pages.
   ============================================================ */

(function () {
    'use strict';

    if (window.__yucart_loaded) return;
    window.__yucart_loaded = true;

    // ── Price patterns ─────────────────────────────────────────
    // Yupoo prices: "160Y", "160y", "160Yuan", "¥160", "￥160", "160元", "P160"
    const PRICE_REGEX = [
        /(\d[\d,.]*)\s*[Yy](?:uan)?(?:\s|$|[【\[\(]|[^\w])/,
        /[¥￥]\s*(\d[\d,.]*)/,
        /(\d[\d,.]*)\s*[¥￥元]/,
        /[Pp](\d[\d,.]*)(?:\s|$|[【\[\(]|[^\w])/
    ];

    let exchangeRate = null;
    let targetCurrency = 'USD';
    let darkModeEnabled = true;

    // ── Cleanup when extension is reloaded ─────────────────────
    let observer = null;
    let htmlObserver = null;
    let viewerObserver = null;
    let viewerCheckInterval = null;
    let scanDebounceTimer = null;
    let lightboxDebounceTimer = null;
    let pendingScanRoots = new Set();
    let pendingFullRescan = false;
    let settingsListenerAttached = false;

    // ── Apply dark mode immediately (before async load) to prevent flash ──
    // Default to dark mode, will be corrected if user disabled it.
    if (document.body) {
        if (darkModeEnabled) {
            document.body.classList.add('yucart-dark-mode');
        }
    } else {
        // document_start: body doesn't exist yet, wait for it
        const initialBodyObserver = new MutationObserver((mutations, obs) => {
            if (document.body) {
                if (darkModeEnabled) {
                    document.body.classList.add('yucart-dark-mode');
                }
                obs.disconnect();
            }
        });
        initialBodyObserver.observe(document.documentElement, { childList: true });
    }

    // ── Helpers ────────────────────────────────────────────────
    function getVendorName() {
        // Try showheader__nickname first (detail pages)
        const nick = document.querySelector('.showheader__nickname');
        if (nick) return nick.textContent.trim();
        // Fallback to subdomain
        const host = window.location.hostname;
        const match = host.match(/^([^.]+)\.x\.yupoo\.com/) || host.match(/^([^.]+)\.yupoo\.com/);
        return match ? match[1] : host;
    }

    function extractPrice(text) {
        for (const re of PRICE_REGEX) {
            const m = text.match(re);
            if (m) {
                const p = parseFloat(m[1].replace(/,/g, ''));
                if (p > 0 && p < 999999) return p;
            }
        }
        return null;
    }

    // Extract the gallery subheading (e.g. Weidian/Taobao product link)
    function getGallerySubtitle() {
        const subtitleEl = document.querySelector('.showalbumheader__gallerysubtitle');
        if (!subtitleEl) return '';
        // The subtitle contains an <a> with a Yupoo redirect URL wrapping the real link
        const anchor = subtitleEl.querySelector('a');
        if (anchor) {
            const href = anchor.getAttribute('href') || '';
            // Unwrap Yupoo's redirect: https://x.yupoo.com/external?url=<encoded>
            const urlMatch = href.match(/[?&]url=([^&]+)/);
            if (urlMatch) {
                try {
                    return decodeURIComponent(decodeURIComponent(urlMatch[1]));
                } catch {
                    return decodeURIComponent(urlMatch[1]);
                }
            }
            return href;
        }
        // Fallback to text content
        return subtitleEl.textContent.trim();
    }

    function getCurrencySymbol(code) {
        const symbols = {
            USD: '$', EUR: '€', GBP: '£', AUD: 'A$', CAD: 'C$',
            JPY: '¥', KRW: '₩', INR: '₹', RUB: '₽', BRL: 'R$',
            MXN: 'MX$', CHF: 'Fr', SEK: 'kr', NOK: 'kr', DKK: 'kr',
            PLN: 'zł', TRY: '₺', THB: '฿', PHP: '₱', MYR: 'RM',
            SGD: 'S$', HKD: 'HK$', TWD: 'NT$', NZD: 'NZ$', ZAR: 'R'
        };
        return symbols[code] || code + ' ';
    }

    function formatConverted(cnyPrice) {
        if (!exchangeRate || !exchangeRate.rate) return '';
        const converted = cnyPrice * exchangeRate.rate;
        return `${getCurrencySymbol(targetCurrency)}${converted.toFixed(2)}`;
    }

    // ── Load exchange rate & dark mode ────────────────────────
    async function loadRate() {
        try {
            const resp = await chrome.runtime.sendMessage({ action: 'getSettings' });
            if (resp?.settings) {
                targetCurrency = resp.settings.targetCurrency || 'USD';
                applyDarkMode(resp.settings.darkMode !== false);
            }

            const rateResp = await chrome.runtime.sendMessage({ action: 'getRate', currency: targetCurrency });
            if (rateResp?.rateData) exchangeRate = rateResp.rateData;
        } catch (e) {
            // Extension context might be invalidated - don't spam console
            if (e.message?.includes('Extension context invalidated')) {
                // Extension was reloaded, clean up
                cleanup();
            } else {
                console.warn('YuCart: Could not load exchange rate', e);
            }
        }
    }

    // ── Apply/remove dark mode ─────────────────────────────────
    function applyDarkMode(enabled) {
        darkModeEnabled = enabled !== false;
        if (!document.body) return;
        document.body.classList.toggle('yucart-dark-mode', darkModeEnabled);
    }

    // ── Listen for settings changes ────────────────────────────
    function handleSettingsChange(changes, area) {
        try {
            if (area === 'sync' && changes.yucart_settings) {
                const newSettings = changes.yucart_settings.newValue;
                if (newSettings) {
                    // Update dark mode
                    if (newSettings.darkMode !== undefined) {
                        applyDarkMode(newSettings.darkMode);
                    }
                    // Update currency if changed
                    if (newSettings.targetCurrency && newSettings.targetCurrency !== targetCurrency) {
                        targetCurrency = newSettings.targetCurrency;
                        loadRate();
                    }
                }
            }
        } catch (e) {
            // Extension context invalidated - clean up
            if (e.message?.includes('Extension context invalidated')) {
                cleanup();
            }
        }
    }

    chrome.storage.onChanged.addListener(handleSettingsChange);
    settingsListenerAttached = true;

    function cleanup() {
        if (observer) { observer.disconnect(); observer = null; }
        if (htmlObserver) { htmlObserver.disconnect(); htmlObserver = null; }
        if (viewerObserver) { viewerObserver.disconnect(); viewerObserver = null; }
        if (viewerCheckInterval) { clearInterval(viewerCheckInterval); viewerCheckInterval = null; }
        if (scanDebounceTimer) { clearTimeout(scanDebounceTimer); scanDebounceTimer = null; }
        if (lightboxDebounceTimer) { clearTimeout(lightboxDebounceTimer); lightboxDebounceTimer = null; }
        if (settingsListenerAttached) {
            chrome.storage.onChanged.removeListener(handleSettingsChange);
            settingsListenerAttached = false;
        }
        pendingScanRoots.clear();
        pendingFullRescan = false;
        // Remove dark mode class on cleanup to avoid orphaned styles
        if (document.body) {
            document.body.classList.remove('yucart-dark-mode');
        }
    }

    // ── Get real image URL (skip lazy-load placeholders) ───────
    function getImageUrl(imgEl) {
        if (!imgEl) return '';
        // Prefer data-src or data-origin-src (real URLs for lazy-loaded images)
        const candidates = [
            imgEl.getAttribute('data-origin-src'),
            imgEl.getAttribute('data-src'),
            imgEl.src
        ];
        for (const url of candidates) {
            if (!url) continue;
            // Skip tiny data URLs (1x1 lazy-load placeholders)
            if (url.startsWith('data:') && url.length < 200) continue;
            // Must be a real URL or a large data URL
            if (url.startsWith('http') || (url.startsWith('data:') && url.length > 200)) {
                return url;
            }
        }
        return '';
    }

    // ── Convert image to base64 via canvas ─────────────────────
    // DNR rule adds Access-Control-Allow-Origin:* to photo.yupoo.com
    // responses, so crossOrigin='anonymous' images won't taint the canvas.
    // The request Origin is the vendor's yupoo subdomain (legitimate).
    function imageToBase64(url) {
        return new Promise((resolve) => {
            if (!url || url.startsWith('data:')) {
                resolve(url || '');
                return;
            }
            // Use small variant for storage efficiency
            const smallUrl = url.replace(/(big|medium|small)\.jpg/, 'small.jpg');
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    const maxSize = 64;
                    let w = img.naturalWidth;
                    let h = img.naturalHeight;
                    if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
                    else { w = Math.round(w * maxSize / h); h = maxSize; }
                    canvas.width = w;
                    canvas.height = h;
                    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                    resolve(canvas.toDataURL('image/jpeg', 0.6));
                } catch (e) {
                    console.warn('[YuCart CS] Canvas export failed:', e.message);
                    resolve('');
                }
            };
            img.onerror = () => {
                console.warn('[YuCart CS] Image load failed for:', smallUrl);
                resolve('');
            };
            img.src = smallUrl;
        });
    }

    // ── Add to cart ────────────────────────────────────────────
    async function addToCart(itemData) {
        // Convert thumbnail to base64 (bypasses cross-origin via DNR CORS rule)
        if (itemData.thumbnail && itemData.thumbnail.startsWith('http')) {
            const cached = await imageToBase64(itemData.thumbnail);
            if (cached) itemData.thumbnail = cached;
        }
        chrome.runtime.sendMessage({ action: 'addToCart', item: itemData }, (resp) => {
            console.log('[YuCart CS] addToCart response:', resp?.success);
            if (resp?.success) {
                showToast(`Added to cart — ¥${itemData.price}`);
            }
        });
    }

    // ── Toast ──────────────────────────────────────────────────
    function showToast(message) {
        if (!document.body) return;
        const existing = document.querySelector('.yucart-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = 'yucart-toast';
        toast.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
      <span>${message}</span>
    `;
        document.body.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('yucart-toast--visible'));
        setTimeout(() => {
            toast.classList.remove('yucart-toast--visible');
            setTimeout(() => toast.remove(), 300);
        }, 2200);
    }

    // ── Create Add-to-Cart button ──────────────────────────────
    function createCartButton(itemData, size = 'normal') {
        const btn = document.createElement('button');
        btn.className = `yucart-add-btn yucart-add-btn--${size}`;

        const convertedStr = formatConverted(itemData.price);
        const priceLabel = convertedStr ? `¥${itemData.price} ≈ ${convertedStr}` : `¥${itemData.price}`;

        btn.innerHTML = `
      <svg width="${size === 'large' ? 18 : 14}" height="${size === 'large' ? 18 : 14}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="9" cy="21" r="1"></circle>
        <circle cx="20" cy="21" r="1"></circle>
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
      </svg>
      <span class="yucart-add-btn__text">Add to Cart</span>
      <span class="yucart-add-btn__price">${priceLabel}</span>
    `;

        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            btn.classList.add('yucart-add-btn--added');
            btn.querySelector('.yucart-add-btn__text').textContent = '⏳ Adding...';
            await addToCart({ ...itemData });
            btn.querySelector('.yucart-add-btn__text').textContent = '✓ Added';
            setTimeout(() => {
                btn.classList.remove('yucart-add-btn--added');
                btn.querySelector('.yucart-add-btn__text').textContent = 'Add to Cart';
            }, 1500);
        });

        return btn;
    }

    function queryIncludingRoot(root, selector) {
        if (!root) return [];
        if (root === document || root.nodeType === Node.DOCUMENT_NODE) {
            return Array.from(document.querySelectorAll(selector));
        }
        if (!(root instanceof Element)) return [];
        const matches = [];
        if (root.matches(selector)) {
            matches.push(root);
        }
        matches.push(...root.querySelectorAll(selector));
        return matches;
    }

    // ══════════════════════════════════════════════════════════
    //  ALBUM LISTING PAGE  (grid of albums)
    // ══════════════════════════════════════════════════════════
    function processAlbumListings(root = document) {
        const albums = queryIncludingRoot(root, '.album__main, .album3__main');
        if (!albums.length) return;

        albums.forEach(album => {
            if (album.querySelector('.yucart-add-btn')) return; // already processed

            const titleEl = album.querySelector('.album__title');
            const titleText = titleEl?.textContent?.trim() || album.getAttribute('title') || '';
            const price = extractPrice(titleText);
            if (!price) return;

            const imgEl = album.querySelector('.album__img, .autocut, img');
            const thumbnail = getImageUrl(imgEl);
            const url = album.href || window.location.href;

            // Clean the title (remove the price prefix)
            const cleanTitle = titleText.replace(/^\d[\d,.]*\s*[Yy](?:uan)?\s*/, '').trim() || titleText;

            const itemData = {
                title: cleanTitle,
                price: price,
                vendor: getVendorName(),
                thumbnail: thumbnail,
                url: url
            };

            // Create overlay container
            const overlay = document.createElement('div');
            overlay.className = 'yucart-album-overlay';

            // Converted price badge
            const convertedStr = formatConverted(price);
            if (convertedStr) {
                const badge = document.createElement('div');
                badge.className = 'yucart-price-badge';
                badge.textContent = `¥${price} ≈ ${convertedStr}`;
                overlay.appendChild(badge);
            }

            // Add to cart button
            const btn = createCartButton(itemData, 'small');
            overlay.appendChild(btn);

            // Make album container relative for overlay positioning
            album.style.position = 'relative';
            album.appendChild(overlay);
        });
    }

    // ══════════════════════════════════════════════════════════
    //  ALBUM DETAIL PAGE  (single product with images)
    // ══════════════════════════════════════════════════════════
    // Cache detail page item data so the lightbox can reuse it
    let detailPageItemData = null;

    function processDetailPage() {
        const titleEl = document.querySelector('.showalbumheader__gallerytitle, .showalbumheader__title');
        if (!titleEl) return;
        if (document.querySelector('.yucart-detail-bar')) return; // already injected

        const titleText = titleEl.textContent.trim();
        const price = extractPrice(titleText);
        if (!price) return;

        // Get first image from gallery
        const galleryImg = document.querySelector('.showalbum__children img');
        const headerImg = document.querySelector('.showalbumheader__gallerycover img');
        const thumbnail = getImageUrl(headerImg) || getImageUrl(galleryImg);

        // Extract subheading (Weidian/Taobao product link)
        const subtitle = getGallerySubtitle();

        // Clean title
        const cleanTitle = titleText.replace(/^\d[\d,.]*\s*[Yy](?:uan)?\s*/, '').trim() || titleText;

        const itemData = {
            title: cleanTitle,
            price: price,
            vendor: getVendorName(),
            thumbnail: thumbnail,
            url: window.location.href,
            subtitle: subtitle
        };

        // Cache for lightbox use
        detailPageItemData = itemData;

        // Create a sticky add-to-cart bar at the top of the content
        const bar = document.createElement('div');
        bar.className = 'yucart-detail-bar';

        const convertedStr = formatConverted(price);
        const priceDisplay = convertedStr ? `¥${price} ≈ ${convertedStr}` : `¥${price}`;

        bar.innerHTML = `
      <div class="yucart-detail-bar__info">
        <span class="yucart-detail-bar__price">${priceDisplay}</span>
        <span class="yucart-detail-bar__title">${cleanTitle.slice(0, 60)}</span>
      </div>
    `;

        const btn = createCartButton(itemData, 'large');
        bar.appendChild(btn);

        // Insert after the header
        const headerArea = document.querySelector('.showalbumheader') || titleEl.parentElement;
        if (headerArea?.parentElement) {
            headerArea.parentElement.insertBefore(bar, headerArea.nextSibling);
        } else {
            document.body.prepend(bar);
        }
    }

    // ══════════════════════════════════════════════════════════
    //  CATEGORY / INDEX PAGE  (showindex view)
    // ══════════════════════════════════════════════════════════
    function processIndexPage(root = document) {
        const items = queryIncludingRoot(root, '.showindex__children a');
        if (!items.length) return;

        items.forEach(item => {
            if (item.querySelector('.yucart-add-btn')) return;

            const titleText = item.getAttribute('title') || item.textContent.trim();
            const price = extractPrice(titleText);
            if (!price) return;

            const imgEl = item.querySelector('img');
            const thumbnail = getImageUrl(imgEl);
            const url = item.href || window.location.href;
            const cleanTitle = titleText.replace(/^\d[\d,.]*\s*[Yy](?:uan)?\s*/, '').trim() || titleText;

            const itemData = {
                title: cleanTitle,
                price: price,
                vendor: getVendorName(),
                thumbnail: thumbnail,
                url: url
            };

            item.style.position = 'relative';

            const overlay = document.createElement('div');
            overlay.className = 'yucart-album-overlay';

            const convertedStr = formatConverted(price);
            if (convertedStr) {
                const badge = document.createElement('div');
                badge.className = 'yucart-price-badge';
                badge.textContent = `¥${price} ≈ ${convertedStr}`;
                overlay.appendChild(badge);
            }

            const btn = createCartButton(itemData, 'small');
            overlay.appendChild(btn);
            item.appendChild(overlay);
        });
    }

    // ══════════════════════════════════════════════════════════
    //  IMAGE VIEWER / LIGHTBOX (native Yupoo overlay)
    // ══════════════════════════════════════════════════════════
    function processImageViewer() {
        const viewerMain = document.querySelector('.viewer__main');

        // Note: Detail bar visibility is now handled by the global observers in init()

        if (!viewerMain) return;
        if (viewerMain.querySelector('.yucart-viewer-bar')) return; // already injected
        if (!detailPageItemData) return; // need detail page context for price

        const itemData = { ...detailPageItemData };

        // Try to get the current viewer image as thumbnail
        const viewerImg = viewerMain.querySelector('.viewer__img img, .viewer__imgwrap img');
        if (viewerImg) {
            const viewerThumb = getImageUrl(viewerImg);
            if (viewerThumb) itemData.thumbnail = viewerThumb;
        }

        const bar = document.createElement('div');
        bar.className = 'yucart-viewer-bar';

        const convertedStr = formatConverted(itemData.price);
        const priceDisplay = convertedStr ? `¥${itemData.price} ≈ ${convertedStr}` : `¥${itemData.price}`;

        bar.innerHTML = `
          <div class="yucart-detail-bar__info">
            <span class="yucart-detail-bar__price">${priceDisplay}</span>
            <span class="yucart-detail-bar__title">${(itemData.title || '').slice(0, 60)}</span>
          </div>
        `;

        const btn = createCartButton(itemData, 'large');
        bar.appendChild(btn);

        // Insert the bar into the viewer — try the info sidebar first, else append to viewer
        const infoWrap = viewerMain.querySelector('.viewer__infowrap');
        if (infoWrap) {
            infoWrap.style.position = 'relative';
            infoWrap.style.paddingBottom = '60px';
            infoWrap.appendChild(bar);
        } else {
            viewerMain.appendChild(bar);
        }
    }

    // ── Main scan ──────────────────────────────────────────────
    function scanPage() {
        processAlbumListings();
        processDetailPage();
        processIndexPage();
        processImageViewer();
    }

    function scanRoot(root) {
        processAlbumListings(root);
        processIndexPage(root);
    }

    function queueRootForScan(node) {
        if (pendingFullRescan || !node) return;

        if (node === document || node === document.documentElement || node === document.body) {
            pendingFullRescan = true;
            pendingScanRoots.clear();
            return;
        }

        const root = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
        if (!root) return;

        pendingScanRoots.add(root);
        if (pendingScanRoots.size > 80) {
            pendingFullRescan = true;
            pendingScanRoots.clear();
        }
    }

    function queueMutationTargets(mutations) {
        for (const mutation of mutations) {
            queueRootForScan(mutation.target);
            for (const addedNode of mutation.addedNodes) {
                queueRootForScan(addedNode);
            }
        }
    }

    function flushQueuedScans() {
        scanDebounceTimer = null;

        if (pendingFullRescan) {
            pendingFullRescan = false;
            pendingScanRoots.clear();
            scanPage();
            return;
        }

        const roots = Array.from(pendingScanRoots);
        pendingScanRoots.clear();

        for (const root of roots) {
            if (root.isConnected) {
                scanRoot(root);
            }
        }

        // These rely on page-level state, so run once per queued batch.
        processDetailPage();
        processImageViewer();
    }

    function scheduleQueuedScan() {
        if (scanDebounceTimer) clearTimeout(scanDebounceTimer);
        scanDebounceTimer = setTimeout(flushQueuedScans, 250);
    }

    // ── Init ───────────────────────────────────────────────────
    async function init() {
        await loadRate();
        scanPage();

        // Re-scan on dynamic content (Yupoo lazy loads)
        // Queue only changed roots and debounce processing.
        observer = new MutationObserver((mutations) => {
            queueMutationTargets(mutations);
            scheduleQueuedScan();
        });
        observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

        // ── Robust Lightbox Detection ──────────────────────────────
        const handleLightboxChange = () => {
            // Debounce to avoid expensive getComputedStyle on rapid mutations
            if (lightboxDebounceTimer) clearTimeout(lightboxDebounceTimer);
            lightboxDebounceTimer = setTimeout(() => {
                const detailBar = document.querySelector('.yucart-detail-bar');
                if (!detailBar) return;

                const htmlStyle = document.documentElement.style;
                const isHtmlLocked = htmlStyle.overflow === 'hidden' && htmlStyle.position === 'fixed';

                const viewerMain = document.querySelector('.viewer__main');
                const isViewerVisible = viewerMain && window.getComputedStyle(viewerMain).display !== 'none';

                if (isHtmlLocked || isViewerVisible) {
                    detailBar.style.setProperty('display', 'none', 'important');
                } else {
                    detailBar.style.removeProperty('display');
                }

                // Also trigger processImageViewer to ensure the inner bar is injected if needed
                if (isViewerVisible) processImageViewer();
            }, 50);
        };

        // 1. Monitor <html> styles
        htmlObserver = new MutationObserver(handleLightboxChange);
        htmlObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['style', 'class']
        });

        // 2. Monitor .viewer__main visibility (attributes)
        // We need to find .viewer__main first, it might be lazy loaded
        viewerObserver = new MutationObserver(handleLightboxChange);

        // Helper to attach viewer observer
        const connectViewerObserver = () => {
            const viewerMain = document.querySelector('.viewer__main');
            if (viewerMain) {
                viewerObserver.observe(viewerMain, {
                    attributes: true,
                    attributeFilter: ['style', 'class', 'hidden']
                });
                return true;
            }
            return false;
        };

        // Attempt to connect immediately
        if (!connectViewerObserver()) {
            // Poll until .viewer__main appears; interval is cleared on cleanup
            viewerCheckInterval = setInterval(() => {
                if (connectViewerObserver()) {
                    clearInterval(viewerCheckInterval);
                    viewerCheckInterval = null;
                }
            }, 1000);
        }
    }

    init();
})();
