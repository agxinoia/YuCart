/* ============================================================
   YuCart — Wiki Content Script (Taobao AU free shipping, beta)
   Marks Taobao and Yupoo links on subreddit wiki pages (e.g. the
   r/FashionReps trusted sellers list) with whether the seller's
   Taobao shop ships free to Australia, and checks them on demand.
   Registered by the service worker only while the feature is on.
   ============================================================ */

(function () {
    'use strict';

    if (window.__yucart_wiki_loaded) return;
    window.__yucart_wiki_loaded = true;

    const AuFreeShip = globalThis.YuCartAuFreeShip;
    if (!AuFreeShip) return;

    // Pause between checks in "Check all" so Taobao doesn't throw up its slider.
    const CHECK_DELAY_MS = 1500;
    const targets = new Map();   // key -> link target, one per seller/listing
    const pending = new Map();   // key -> 'checking' or a status that isn't cached
    let results = AuFreeShip.emptyResults();
    let batch = null;            // { stopped, done, total } while "Check all" runs
    let panelNote = '';
    let panel = null;
    let scanTimer = null;
    let nextEligibleIndex = 0;

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function targetForUrl(href) {
        const vendor = AuFreeShip.parseYupooVendor(href);
        if (vendor) return { key: `yupoo:${vendor}`, kind: 'yupoo', vendor };

        const link = AuFreeShip.parseTaobaoLink(href);
        if (!link) return null;
        const key = link.type === 'item'
            ? `item:${link.itemId}`
            : link.type === 'shop' ? AuFreeShip.shopKeys(link)[0] : `short:${link.url}`;
        return { key, kind: 'taobao', url: href, link };
    }

    function recordFor(target) {
        if (target.kind === 'yupoo') return results.vendors[target.vendor] || null;
        return AuFreeShip.lookupTaobaoLink(results, target.link);
    }

    function statusFor(target) {
        return pending.get(target.key) || recordFor(target)?.status || 'unchecked';
    }

    function tooltip(status, record) {
        const lines = [AuFreeShip.describeStatus(status).detail];
        if (record?.matched) lines.push(`Matched: ${record.matched}`);
        if (record?.shopName) lines.push(`Shop: ${record.shopName}`);
        if (record?.checkedAt) lines.push(`Checked ${new Date(record.checkedAt).toLocaleDateString()}`);
        if (status !== 'checking' && status !== 'unchecked') lines.push('Click to check again');
        return lines.join('\n');
    }

    // ── Link badges ────────────────────────────────────────────
    function annotateLinks() {
        scanTimer = null;
        for (const anchor of document.querySelectorAll('a[href]')) {
            if (anchor.dataset.yucartAu || anchor.closest('.yucart-wiki-panel')) continue;
            const target = targetForUrl(anchor.href);
            anchor.dataset.yucartAu = target ? target.key : '-';
            if (!target) continue;
            if (!targets.has(target.key)) targets.set(target.key, target);

            const badge = document.createElement('button');
            badge.type = 'button';
            badge.className = 'yucart-au-badge';
            badge.dataset.key = target.key;
            badge.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                checkOne(targets.get(target.key));
            });
            anchor.insertAdjacentElement('afterend', badge);
        }
        render();
    }

    function render() {
        for (const badge of document.querySelectorAll('.yucart-au-badge')) {
            const target = targets.get(badge.dataset.key);
            if (!target) continue;
            const status = statusFor(target);
            const meta = AuFreeShip.describeStatus(status);
            // Only touch the DOM on change so the observer doesn't loop.
            if (badge.textContent !== meta.label) badge.textContent = meta.label;
            if (badge.dataset.tone !== meta.tone) badge.dataset.tone = meta.tone;
            badge.title = tooltip(status, recordFor(target));
        }
        renderPanel();
    }

    // ── Summary panel ──────────────────────────────────────────
    function renderPanel() {
        if (!targets.size) {
            panel?.remove();
            panel = null;
            return;
        }
        if (!panel) {
            panel = document.createElement('div');
            panel.className = 'yucart-wiki-panel';
            panel.innerHTML = `
                <div class="yucart-wiki-panel__title">YuCart · Taobao free shipping to AU</div>
                <div class="yucart-wiki-panel__stats"></div>
                <div class="yucart-wiki-panel__note"></div>
                <div class="yucart-wiki-panel__actions">
                    <button type="button" class="yucart-wiki-panel__btn" data-action="batch"></button>
                    <button type="button" class="yucart-wiki-panel__btn yucart-wiki-panel__btn--ghost" data-action="next">Next eligible ↓</button>
                </div>
            `;
            panel.querySelector('[data-action="batch"]').addEventListener('click', () => {
                if (batch) batch.stopped = true;
                else runBatch();
            });
            panel.querySelector('[data-action="next"]').addEventListener('click', scrollToNextEligible);
            document.body.appendChild(panel);
        }

        const all = [...targets.values()];
        const checked = all.filter((target) => recordFor(target)).length;
        const eligible = all.filter((target) => recordFor(target)?.status === 'eligible').length;
        const stats = `${eligible} eligible · ${checked}/${all.length} sellers & listings checked`;
        const note = batch ? `${batch.done} of ${batch.total} checked… (Taobao opens in a background tab)` : panelNote;
        const batchLabel = batch ? 'Stop' : 'Check unchecked';

        setText(panel.querySelector('.yucart-wiki-panel__stats'), stats);
        setText(panel.querySelector('.yucart-wiki-panel__note'), note);
        setText(panel.querySelector('[data-action="batch"]'), batchLabel);
        panel.querySelector('[data-action="next"]').hidden = eligible === 0;
    }

    function setText(element, text) {
        if (element && element.textContent !== text) element.textContent = text;
    }

    function scrollToNextEligible() {
        const badges = Array.from(document.querySelectorAll('.yucart-au-badge[data-tone="good"]'));
        if (!badges.length) return;
        const badge = badges[nextEligibleIndex % badges.length];
        nextEligibleIndex++;
        badge.scrollIntoView({ behavior: 'smooth', block: 'center' });
        badge.classList.add('yucart-au-badge--flash');
        setTimeout(() => badge.classList.remove('yucart-au-badge--flash'), 1200);
    }

    // ── Checks ─────────────────────────────────────────────────
    async function checkOne(target) {
        if (!target || pending.get(target.key) === 'checking') return '';
        pending.set(target.key, 'checking');
        render();

        const messageTarget = target.kind === 'yupoo'
            ? { kind: 'yupoo', vendor: target.vendor }
            : { kind: 'taobao', url: target.url };
        let status = 'error';
        try {
            const outcome = await chrome.runtime.sendMessage({ action: 'auFreeShipCheck', target: messageTarget });
            status = outcome?.status || 'error';
        } catch {
            status = 'error';
        }

        // Cached outcomes arrive through storage.onChanged.
        if (AuFreeShip.STORED_STATUSES.includes(status)) pending.delete(target.key);
        else pending.set(target.key, status);
        render();
        return status;
    }

    async function runBatch() {
        const queue = [...targets.values()].filter((target) => !recordFor(target));
        if (!queue.length) {
            panelNote = 'Every link on this page has been checked. Click a badge to re-check it.';
            renderPanel();
            return;
        }

        batch = { stopped: false, done: 0, total: queue.length };
        panelNote = '';
        renderPanel();
        for (const target of queue) {
            if (batch.stopped) break;
            // An earlier check may already have covered this seller's shop.
            const needsCheck = !recordFor(target);
            if (needsCheck) {
                const status = await checkOne(target);
                if (AuFreeShip.BLOCKING_STATUSES.includes(status)) {
                    panelNote = `Paused: ${AuFreeShip.describeStatus(status).detail}.`;
                    break;
                }
            }
            batch.done++;
            renderPanel();
            if (needsCheck && !batch.stopped) await sleep(CHECK_DELAY_MS);
        }
        if (!panelNote) panelNote = batch.stopped ? 'Stopped.' : 'Done.';
        batch = null;
        renderPanel();
    }

    // ── Init ───────────────────────────────────────────────────
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes[AuFreeShip.STORAGE_KEY]) return;
        results = AuFreeShip.normalizeResults(changes[AuFreeShip.STORAGE_KEY].newValue);
        render();
    });

    // Reddit renders parts of the page after load.
    const observer = new MutationObserver((mutations) => {
        const hasNewContent = mutations.some((mutation) => Array.from(mutation.addedNodes).some((node) =>
            node.nodeType === Node.ELEMENT_NODE && !node.closest('.yucart-au-badge, .yucart-wiki-panel')
        ));
        if (hasNewContent && !scanTimer) scanTimer = setTimeout(annotateLinks, 300);
    });

    chrome.storage.local.get(AuFreeShip.STORAGE_KEY).then((stored) => {
        results = AuFreeShip.normalizeResults(stored[AuFreeShip.STORAGE_KEY]);
        annotateLinks();
        observer.observe(document.body, { childList: true, subtree: true });
    });
})();
