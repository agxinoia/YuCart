/* ============================================================
   YuCart — Taobao AU Free Shipping Finder (shared)
   Taobao's Global Free Shipping Plan (全球包邮计划) tags items that
   ship free to Australia with "境外满包邮" once an order reaches
   ¥249. Sellers opt in, so finding the tag on a seller's listings
   tells us which suppliers take part. Loaded by the service worker,
   the Yupoo and wiki content scripts, and the options page.
   ============================================================ */

(function initAuFreeShip(global) {
    const THRESHOLD_CNY = 249;
    const STORAGE_KEY = 'yucart_au_freeship';
    const SETTING_KEY = 'betaAuFreeShipEnabled';

    // Requested at runtime when the feature is switched on in settings.
    const OPTIONAL_ORIGINS = Object.freeze([
        'https://*.taobao.com/*',
        'https://*.tmall.com/*',
        'https://*.tb.cn/*',
        'https://*.reddit.com/*'
    ]);

    // Registered by the service worker once the reddit permission is granted.
    const WIKI_SCRIPT = Object.freeze({
        id: 'yucart-au-freeship-wiki',
        matches: ['https://*.reddit.com/r/*/wiki', 'https://*.reddit.com/r/*/wiki/*'],
        js: ['shared/au-freeship.js', 'content/wiki.js'],
        css: ['content/wiki.css']
    });

    // Text of the program's tag, kept as {source, flags} so the list can be
    // passed into scripts injected into Taobao tabs. Plain "包邮" is domestic
    // free shipping inside China and is deliberately not matched.
    const LABEL_PATTERNS = Object.freeze([
        { source: '境外\\s*满?\\s*\\d*\\s*元?\\s*包邮', flags: '' },
        { source: '(?:海外|跨境)\\s*满?\\s*\\d*\\s*元?\\s*包邮', flags: '' },
        { source: '澳(?:大利亚|洲)\\s*站?\\s*满?\\s*\\d*\\s*元?\\s*包邮', flags: '' },
        { source: '全球\\s*包邮', flags: '' },
        { source: `满\\s*${THRESHOLD_CNY}\\s*元?\\s*包邮`, flags: '' },
        { source: 'free\\s+shipping\\s+to\\s+australia', flags: 'i' },
        { source: 'free\\s+(?:international|overseas|cross[-\\s]border|global)\\s+shipping', flags: 'i' },
        { source: `free\\s+shipping\\s+(?:on\\s+|for\\s+)?(?:orders?\\s+)?(?:over|above|from)\\s*(?:cn)?[¥￥]\\s*${THRESHOLD_CNY}`, flags: 'i' }
    ]);

    // Other page states the checker needs to recognise on Taobao/Tmall.
    const PAGE_PATTERNS = Object.freeze({
        auContext: ['澳大利亚', '澳洲', 'australia'],
        security: ['拖动下方滑块', '滑动验证', '安全验证', '访问受限', 'unusual traffic', 'slide to verify', 'verify you are human'],
        unavailable: ['宝贝不存在', '宝贝已下架', '商品已下架', '商品不存在', 'item has been removed', 'no longer available']
    });

    // Subdomains of taobao.com / tmall.com that are platform pages, not shops.
    const RESERVED_SUBDOMAINS = Object.freeze([
        'www', 'item', 'detail', 'login', 'passport', 's', 'list', 'cart', 'buy', 'trade', 'i', 'h5', 'm',
        'main', 'world', 'market', 'store', 'favorite', 'rate', 'g', 'img', 'gw', 'err', 'shop', 'ai',
        'uland', 'pages', 'chaoshi', 'jx', 'huodong', 'pages-fast', 'login-m', 'member1', 'consumerservice'
    ]);

    const STATUS = Object.freeze({
        eligible: {
            label: `AU free ship ¥${THRESHOLD_CNY}+`,
            detail: `Taobao shows "境外满包邮": free shipping to Australia on orders of ¥${THRESHOLD_CNY}+`,
            tone: 'good'
        },
        not_found: {
            label: 'No AU free ship',
            detail: 'No "境外满包邮" tag on the Taobao listings checked',
            tone: 'muted'
        },
        not_taobao: {
            label: 'Not on Taobao',
            detail: 'Only Weidian/1688 links found, which are not part of Taobao\'s AU program',
            tone: 'muted'
        },
        no_links: {
            label: 'No Taobao link',
            detail: 'No Taobao listings found to check',
            tone: 'muted'
        },
        unchecked: {
            label: 'Check AU free ship',
            detail: 'Check Taobao for free shipping to Australia',
            tone: 'idle'
        },
        checking: {
            label: 'Checking Taobao…',
            detail: 'Opening the listing on Taobao in a background tab',
            tone: 'busy'
        },
        login_required: {
            label: 'Log in to Taobao',
            detail: 'Taobao asked you to log in. Log in on the tab that opened, then check again',
            tone: 'warn'
        },
        security_check: {
            label: 'Taobao verification',
            detail: 'Taobao showed a verification slider. Complete it on the tab that opened, then check again',
            tone: 'warn'
        },
        region_unknown: {
            label: 'Set AU address',
            detail: 'Taobao is not showing Australian delivery. Set your Taobao delivery address to Australia and check again',
            tone: 'warn'
        },
        permission_required: {
            label: 'Enable in settings',
            detail: 'Turn on the Taobao AU Free Shipping Finder in YuCart settings',
            tone: 'warn'
        },
        unavailable: {
            label: 'Listing removed',
            detail: 'The Taobao listing is no longer available',
            tone: 'muted'
        },
        error: {
            label: 'Check failed',
            detail: 'The Taobao page did not load in time. Try again',
            tone: 'warn'
        }
    });

    // Results that describe the seller and are worth caching.
    const STORED_STATUSES = Object.freeze(['eligible', 'not_found', 'not_taobao', 'no_links']);
    // Results that will repeat for every remaining link until the user acts.
    const BLOCKING_STATUSES = Object.freeze(['login_required', 'security_check', 'region_unknown', 'permission_required']);

    function describeStatus(status) {
        return STATUS[status] || STATUS.error;
    }

    function digitsOnly(value) {
        const text = String(value ?? '').trim();
        return /^\d{4,}$/.test(text) ? text : '';
    }

    function parseUrl(raw) {
        const value = String(raw || '').trim();
        if (!value) return null;
        try {
            return new URL(/^https?:\/\//i.test(value) ? value : `https://${value.replace(/^\/\//, '')}`);
        } catch {
            return null;
        }
    }

    function itemUrl(itemId) {
        return `https://item.taobao.com/item.htm?id=${encodeURIComponent(itemId)}`;
    }

    // Pull the first Taobao/Tmall link out of free text such as a Yupoo subtitle.
    function extractTaobaoLink(text) {
        const match = String(text || '').match(/(?:https?:\/\/)?[a-z0-9.-]*(?:taobao\.com|tmall\.com|tb\.cn)(?:[/?#][^\s<>"']*)?/i);
        return match ? match[0] : '';
    }

    // Classify a Taobao/Tmall link as an item, a shop, or a short link that
    // only resolves once it is opened.
    function parseTaobaoLink(raw) {
        const url = parseUrl(raw);
        if (!url) return null;
        const host = url.hostname.toLowerCase();
        const isTaobao = /(^|\.)taobao\.com$/.test(host);
        const isTmall = /(^|\.)tmall\.com$/.test(host);
        if (/(^|\.)tb\.cn$/.test(host)) return { type: 'short', url: url.href };
        if (!isTaobao && !isTmall) return null;

        const looksLikeItem = /^(?:[a-z]+\.)?(?:item|detail)\./.test(host) || /item|detail/i.test(url.pathname);
        const itemId = digitsOnly(looksLikeItem ? (url.searchParams.get('id') || url.searchParams.get('itemId')) : '') ||
            digitsOnly(url.pathname.match(/\/(?:item\/|i)(\d+)\.htm/i)?.[1]);
        if (itemId) return { type: 'item', itemId, url: itemUrl(itemId) };

        const shopId = digitsOnly(host.match(/^shop(\d+)\.(?:m\.)?taobao\.com$/)?.[1]) ||
            digitsOnly(url.pathname.match(/\/dianpu\/(\d+)/)?.[1]) ||
            digitsOnly(url.searchParams.get('shopId') || url.searchParams.get('shop_id'));
        const sellerId = digitsOnly(url.searchParams.get('user_number_id') || url.searchParams.get('sellerId') || url.searchParams.get('userId'));
        const subdomain = host.replace(/\.(?:taobao|tmall)\.com$/, '');
        const storeHost = !shopId && subdomain && subdomain !== host && !subdomain.includes('.') && !RESERVED_SUBDOMAINS.includes(subdomain)
            ? host
            : '';
        if (!shopId && !sellerId && !storeHost) return null;
        return { type: 'shop', shopId, sellerId, storeHost, url: url.href };
    }

    // Every key a shop can be looked up by, most specific first.
    function shopKeys(identity) {
        if (!identity) return [];
        return [
            identity.shopId && `shop:${identity.shopId}`,
            identity.storeHost && `host:${identity.storeHost}`,
            identity.sellerId && `seller:${identity.sellerId}`
        ].filter(Boolean);
    }

    // Yupoo store slug, e.g. "goat" for https://goat.x.yupoo.com/albums.
    function parseYupooVendor(raw) {
        const url = parseUrl(raw);
        const slug = url?.hostname.toLowerCase().match(/^([a-z0-9-]+)\.(?:x\.)?yupoo\.com$/)?.[1] || '';
        return ['www', 'x', 'photo', 'pic', 'static', 'm', 'h5', 'api', 's', 'img'].includes(slug) ? '' : slug;
    }

    function emptyResults() {
        return { items: {}, shops: {}, vendors: {}, shortLinks: {} };
    }

    function normalizeResults(value) {
        return { ...emptyResults(), ...(value && typeof value === 'object' ? value : {}) };
    }

    // Cached result for a parsed Taobao link, or null if it was never checked.
    function lookupTaobaoLink(results, link) {
        if (!results || !link) return null;
        if (link.type === 'item') return results.items[link.itemId] || null;
        if (link.type === 'shop') {
            for (const key of shopKeys(link)) {
                if (results.shops[key]) return results.shops[key];
            }
            return null;
        }
        const resolvedId = results.shortLinks[link.url];
        return resolvedId ? results.items[resolvedId] || null : null;
    }

    // Everything the checker needs inside a Taobao tab, in serialisable form.
    function inspectConfig() {
        return {
            labelPatterns: LABEL_PATTERNS,
            auContextPatterns: PAGE_PATTERNS.auContext,
            securityPatterns: PAGE_PATTERNS.security,
            unavailablePatterns: PAGE_PATTERNS.unavailable,
            reservedSubdomains: RESERVED_SUBDOMAINS
        };
    }

    global.YuCartAuFreeShip = Object.freeze({
        THRESHOLD_CNY,
        STORAGE_KEY,
        SETTING_KEY,
        OPTIONAL_ORIGINS,
        WIKI_SCRIPT,
        STORED_STATUSES,
        BLOCKING_STATUSES,
        describeStatus,
        extractTaobaoLink,
        parseTaobaoLink,
        parseYupooVendor,
        shopKeys,
        itemUrl,
        emptyResults,
        normalizeResults,
        lookupTaobaoLink,
        inspectConfig
    });
})(globalThis);
