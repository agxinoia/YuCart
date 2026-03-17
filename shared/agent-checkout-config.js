(function initAgentCheckoutConfig(global) {
    const SUPERBUY_PARTNER_CODE = 'Eb6pHI';
    const ALLCHINABUY_PARTNER_CODE = 'Eb65dD';
    const KAKOBUY_AFFCODE = 'yucart';
    const SUGARGOO_MEMBER_ID = '3161294460426724183';
    const ACBUY_USER_CODE = 'K9ZLJF';
    const MULEBUY_REF = '201039387';
    const OOPBUY_INVITE_CODE = 'SEZRCZCLM';

    const COMMON_SUCCESS_TEXT_PATTERNS = [
        'successfully added to the shopping cart',
        'item added successfully',
        'added successfully',
        'added to cart',
        'added to shopping cart',
        'shopping cart',
        'cart added',
        '加入购物车',
        '加入購物車',
        '已加入购物车',
        '已加入購物車',
        '成功'
    ];

    const COMMON_LOGIN_TEXT_PATTERNS = [
        'log in',
        'login',
        'sign in',
        'sign up',
        'register',
        'welcome back',
        'forgot your password',
        'sign in with google',
        'your privacy data will be protected'
    ];

    const COMMON_SECURITY_TEXT_PATTERNS = [
        'verifying you are human',
        'performing security verification',
        'security service',
        'this page is displayed while the website verifies you are not a bot',
        'just a moment',
        'cloudflare'
    ];

    const COMMON_FAILURE_TEXT_PATTERNS = [
        'risk reminder',
        'unable to purchase',
        'cannot purchase',
        'failed to get the information',
        'out of stock',
        'sold out',
        'not found',
        'manual input'
    ];

    const AGENT_META = Object.freeze({
        superbuy: { name: 'Superbuy' },
        allchinabuy: { name: 'AllChinaBuy' },
        kakobuy: { name: 'KakoBuy' },
        sugargoo: { name: 'Sugargoo' },
        acbuy: { name: 'ACBuy' },
        mulebuy: { name: 'Mulebuy' },
        oopbuy: { name: 'OOPBUY' },
        raw: { name: 'Raw Link' }
    });

    function appendQueryParam(url, key, value) {
        const parsed = new URL(url);
        parsed.searchParams.set(key, value);
        return parsed.toString();
    }

    function getUrlSearchParam(rawUrl, keys) {
        const url = new URL(rawUrl);
        for (const key of keys) {
            const value = url.searchParams.get(key);
            if (value) return value;
        }
        return '';
    }

    function getMarketplaceContext(rawUrl) {
        try {
            const url = new URL(rawUrl);
            const host = url.hostname.toLowerCase();

            if (host.includes('weidian.com')) {
                return {
                    itemId: getUrlSearchParam(rawUrl, ['itemID', 'itemId', 'id']),
                    sourceCode: 'WD',
                    platformCode: 'WEIDIAN',
                    platformSlug: 'weidian'
                };
            }

            if (host.includes('taobao.com') || host.includes('tmall.com')) {
                return {
                    itemId: getUrlSearchParam(rawUrl, ['id']),
                    sourceCode: 'TB',
                    platformCode: 'TAOBAO',
                    platformSlug: 'taobao'
                };
            }

            if (host.includes('1688.com')) {
                const pathMatch = url.pathname.match(/\/offer\/(\d+)\.html/i);
                return {
                    itemId: pathMatch?.[1] || getUrlSearchParam(rawUrl, ['offerId', 'id']),
                    sourceCode: '1688',
                    platformCode: '1688',
                    platformSlug: '1688'
                };
            }
        } catch (error) {
            return null;
        }

        return null;
    }

    const BASE_AGENT_URL_BUILDERS = {
        superbuy: (rawUrl) => `https://www.superbuy.com/en/page/buy/?nTag=Home-search&from=search-input&url=${encodeURIComponent(rawUrl)}`,
        allchinabuy: (rawUrl) => `https://www.allchinabuy.com/en/page/buy/?nTag=Home-search&from=search-input&_search=url&position=&url=${encodeURIComponent(rawUrl)}`,
        kakobuy: (rawUrl) => `https://www.kakobuy.com/item/details?url=${encodeURIComponent(rawUrl)}`,
        raw: (rawUrl) => rawUrl
    };

    function buildAgentCheckoutUrl(agentId, productUrl) {
        const market = getMarketplaceContext(productUrl);

        switch (agentId) {
            case 'superbuy':
                return appendQueryParam(BASE_AGENT_URL_BUILDERS.superbuy(productUrl), 'partnercode', SUPERBUY_PARTNER_CODE);
            case 'allchinabuy':
                return appendQueryParam(BASE_AGENT_URL_BUILDERS.allchinabuy(productUrl), 'partnercode', ALLCHINABUY_PARTNER_CODE);
            case 'kakobuy':
                return appendQueryParam(BASE_AGENT_URL_BUILDERS.kakobuy(productUrl), 'affcode', KAKOBUY_AFFCODE);
            case 'sugargoo':
                return `https://www.sugargoo.com/products?productLink=${encodeURIComponent(productUrl)}&memberId=${SUGARGOO_MEMBER_ID}`;
            case 'acbuy':
                if (!market?.itemId) return null;
                return `https://www.acbuy.com/product?id=${encodeURIComponent(market.itemId)}&u=${ACBUY_USER_CODE}&source=${encodeURIComponent(market.sourceCode)}`;
            case 'mulebuy':
                if (!market?.itemId) return null;
                return `https://mulebuy.com/product?id=${encodeURIComponent(market.itemId)}&platform=${encodeURIComponent(market.platformCode)}&ref=${MULEBUY_REF}`;
            case 'oopbuy':
                if (!market?.itemId) return null;
                return `https://oopbuy.com/product/${encodeURIComponent(market.platformSlug)}/${encodeURIComponent(market.itemId)}?inviteCode=${OOPBUY_INVITE_CODE}`;
            case 'raw':
                return productUrl;
            default:
                return null;
        }
    }

    const antCheckoutConfig = {
        readySelectors: ['.goods-addToCart', '.btn-addToCart', '.ant-btn', '.ant-input-number'],
        addToCartSelectors: ['button.goods-addToCart', '.goods-addToCart', '.btn-addToCart', 'button[class*="addToCart"]'],
        addToCartTextPatterns: ['add to cart', '加入购物车', '加入購物車'],
        readyTextPatterns: ['add to cart', 'buy now', 'quantity', 'shopping cart'],
        successSelectors: ['.ant-message-success', '.ant-message-notice-content', '.ant-modal-content', '.ant-notification-notice-success'],
        confirmSelectors: ['.ant-modal-footer .ant-btn-primary', '.ant-modal-confirm-btns .ant-btn-primary', '.ant-btn-primary'],
        cartBadgeSelectors: ['.cart-count', '.badge', '[class*="cart-num"]', '[class*="cartNum"]', '.shopping-cart .num'],
        loginTextPatterns: COMMON_LOGIN_TEXT_PATTERNS,
        securityTextPatterns: COMMON_SECURITY_TEXT_PATTERNS,
        failureTextPatterns: COMMON_FAILURE_TEXT_PATTERNS,
        successTextPatterns: COMMON_SUCCESS_TEXT_PATTERNS,
        agreementTextPatterns: ['agree', 'agreed']
    };

    const AGENT_CHECKOUT_CONFIG = Object.freeze({
        superbuy: {
            ...antCheckoutConfig
        },
        allchinabuy: {
            ...antCheckoutConfig
        },
        kakobuy: {
            readySelectors: ['.cancel-btn.buy-btn', '.submit-btn.buy-btn', '.el-input-number', '.refresh-btn', '.cart-link'],
            addToCartSelectors: ['button.cancel-btn.buy-btn', '.cancel-btn.buy-btn'],
            addToCartTextPatterns: ['add to shopping cart', 'add to cart'],
            readyTextPatterns: ['add to shopping cart', 'buy now', 'quantity'],
            successSelectors: ['.el-message', '.el-message--success', '.el-dialog__wrapper', '.dialog_btn'],
            confirmSelectors: ['.dialog_btn', '.el-dialog__footer .el-button--primary', '.el-button--primary'],
            cartBadgeSelectors: ['li.cart', '.cart-link', '.cart'],
            loginTextPatterns: COMMON_LOGIN_TEXT_PATTERNS,
            failureTextPatterns: COMMON_FAILURE_TEXT_PATTERNS,
            successTextPatterns: COMMON_SUCCESS_TEXT_PATTERNS,
            agreementTextPatterns: ['agree', 'agreed']
        },
        sugargoo: {
            readySelectors: ['button.ant-btn.add-cart', '.ant-btn.add-cart', 'button.add-cart', '.item-cart'],
            addToCartSelectors: ['button.ant-btn.add-cart', '.ant-btn.add-cart', 'button.add-cart'],
            addToCartTextPatterns: ['add to cart', 'agent buy', '加入购物车'],
            readyTextPatterns: ['add to cart', 'agent buy', 'quantity', 'shopping guide'],
            successSelectors: ['.el-message', '.el-message--success', '.ant-message-success', '.ant-modal-content', '.ant-message-notice-content'],
            confirmSelectors: ['.ant-modal-footer .ant-btn-primary', '.el-button--primary', '.ant-btn-primary'],
            cartBadgeSelectors: ['.item-cart', '.cart-count', '[class*="cart-num"]', '[class*="cartNum"]'],
            loginTextPatterns: COMMON_LOGIN_TEXT_PATTERNS,
            failureTextPatterns: COMMON_FAILURE_TEXT_PATTERNS,
            successTextPatterns: COMMON_SUCCESS_TEXT_PATTERNS,
            agreementTextPatterns: ['agree', 'agreed']
        },
        acbuy: {
            readySelectors: ['.add-btn', '.btn-list', '.go-cart', '.el-button--primary.go-cart'],
            addToCartSelectors: ['button.add-btn', '.add-btn', '.btn-list .el-button--primary.is-plain', '.btn-list .el-button--primary'],
            addToCartTextPatterns: ['add to cart'],
            readyTextPatterns: ['add to cart', 'buy now', 'quantity'],
            successSelectors: ['.el-message', '.el-message-box', '.el-notification', '.el-dialog', '.el-overlay'],
            confirmSelectors: ['.el-message-box__btns .el-button--primary', '.el-button--primary'],
            cartBadgeSelectors: ['.cart', '.go-cart', '.icon-cart'],
            loginGateSelectors: ['.submit-button', '.el-dialog .submit-button', '.el-overlay .submit-button'],
            loginTextPatterns: COMMON_LOGIN_TEXT_PATTERNS,
            failureTextPatterns: COMMON_FAILURE_TEXT_PATTERNS,
            successTextPatterns: COMMON_SUCCESS_TEXT_PATTERNS,
            agreementTextPatterns: ['agree', 'agreed']
        },
        mulebuy: {
            readySelectors: ['button.n-button.custom-button.cancel', 'button.custom-button.cancel', '.custom-button.cancel', '.n-badge', '.cart_badge'],
            addToCartSelectors: ['button.n-button.custom-button.cancel', 'button.custom-button.cancel', '.custom-button.cancel'],
            addToCartTextPatterns: ['add to cart'],
            readyTextPatterns: ['add to cart', 'buy now', 'quantity', 'shipping fee estimate'],
            successSelectors: ['.n-message', '.n-notification', '.n-dialog', '.n-modal'],
            confirmSelectors: ['.n-button--primary', '.n-dialog .n-button'],
            cartBadgeSelectors: ['.cart_badge .n-badge-sup', '.cart_badge', '.n-badge-sup'],
            loginTextPatterns: COMMON_LOGIN_TEXT_PATTERNS,
            securityTextPatterns: COMMON_SECURITY_TEXT_PATTERNS,
            failureTextPatterns: COMMON_FAILURE_TEXT_PATTERNS,
            successTextPatterns: COMMON_SUCCESS_TEXT_PATTERNS,
            agreementTextPatterns: ['agree', 'agreed']
        },
        oopbuy: {
            readySelectors: ['.add-btn', '.buy-btn', '.cart-wrap', '.ivu-input-number'],
            addToCartSelectors: ['span.add-btn', '.add-btn'],
            addToCartTextPatterns: ['add to cart'],
            readyTextPatterns: ['add to cart', 'buy now', 'quantity'],
            successSelectors: ['.ivu-message', '.ivu-message-notice', '.ivu-modal-content'],
            confirmSelectors: ['.ivu-modal-footer .ivu-btn-primary', '.ivu-btn-primary'],
            cartBadgeSelectors: [],
            loginGateSelectors: ['.login-btn', '.ivu-modal-wrap', '.ivu-modal-content'],
            loginTextPatterns: COMMON_LOGIN_TEXT_PATTERNS,
            failureTextPatterns: COMMON_FAILURE_TEXT_PATTERNS,
            successTextPatterns: COMMON_SUCCESS_TEXT_PATTERNS,
            agreementTextPatterns: ['agree', 'agreed', 'i have read']
        },
        raw: {
            readySelectors: [],
            addToCartSelectors: [],
            addToCartTextPatterns: [],
            readyTextPatterns: [],
            successSelectors: [],
            confirmSelectors: [],
            cartBadgeSelectors: [],
            loginTextPatterns: [],
            failureTextPatterns: [],
            successTextPatterns: [],
            agreementTextPatterns: []
        }
    });

    function getAgentCheckoutConfig(agentId) {
        return AGENT_CHECKOUT_CONFIG[agentId] || null;
    }

    global.YuCartAgentCheckout = Object.freeze({
        AGENT_META,
        AGENT_CHECKOUT_CONFIG,
        buildAgentCheckoutUrl,
        getAgentCheckoutConfig,
        getMarketplaceContext
    });
})(globalThis);
