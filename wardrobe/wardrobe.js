/* ============================================================
   YuCart — Wardrobe Page Logic
   Calendar, geolocation, weather, AI outfits, wardrobe grid
   ============================================================ */

// ── State ──────────────────────────────────────────────────────
let wardrobe = [];
let outfits = [];
let selectedDate = new Date();
let calendarOffset = 0; // weeks offset from current week
let userLocation = null; // { lat, lng }
let weatherData = null; // { temp, condition, icon }
let settings = {};
let activeView = 'wardrobe'; // 'wardrobe' | 'outfits'

// ── Init ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    settings = await loadSettings();
    if (settings.betaWardrobeEnabled !== true) {
        renderBetaDisabledState();
        return;
    }
    await loadWardrobe();
    await loadOutfits();
    renderCalendar();
    renderWardrobe();
    renderOutfits();
    bindEvents();
    bindViewSwitcher();
    updateGenerateBtn();
    // Try to load cached location
    tryLoadCachedLocation();
});

function renderBetaDisabledState() {
    document.body.innerHTML = `
        <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#faf7f3;color:#1f2937;font-family:Inter,sans-serif;">
            <div style="max-width:560px;text-align:center;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;padding:28px;box-shadow:0 16px 44px rgba(17,24,39,0.08);">
                <h1 style="margin:0 0 12px;font-size:24px;line-height:1.2;">Wardrobe Is In Beta</h1>
                <p style="margin:0 0 18px;color:#4b5563;line-height:1.5;">
                    Enable <strong>Wardrobe (Beta)</strong> in YuCart Settings to use this feature.
                </p>
                <button id="openSettingsBtn" style="background:#111827;color:#ffffff;border:none;border-radius:10px;padding:10px 16px;font-size:14px;cursor:pointer;">
                    Open Settings
                </button>
            </div>
        </div>
    `;

    const openSettingsBtn = document.getElementById('openSettingsBtn');
    if (openSettingsBtn) {
        openSettingsBtn.addEventListener('click', () => {
            chrome.runtime.openOptionsPage();
        });
    }
}

async function loadSettings() {
    const res = await chrome.runtime.sendMessage({ action: 'getSettings' });
    return res.settings || {};
}

async function loadWardrobe() {
    const res = await chrome.runtime.sendMessage({ action: 'getWardrobe' });
    wardrobe = res.wardrobe || [];
    document.getElementById('itemCount').textContent = wardrobe.length;
}

async function loadOutfits() {
    const res = await chrome.runtime.sendMessage({ action: 'getOutfits' });
    outfits = res.outfits || [];
}

// ── Events ─────────────────────────────────────────────────────
function bindEvents() {
    document.getElementById('calPrev').addEventListener('click', () => {
        calendarOffset--;
        renderCalendar();
        onDateChanged();
    });
    document.getElementById('calNext').addEventListener('click', () => {
        calendarOffset++;
        renderCalendar();
        onDateChanged();
    });
    document.getElementById('locationBtn').addEventListener('click', requestLocation);
    document.getElementById('generateBtn').addEventListener('click', generateOutfit);

    const clearBtn = document.getElementById('clearWardrobeBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', async () => {
            if (!confirm('Clear all wardrobe items?')) return;
            await chrome.runtime.sendMessage({ action: 'clearWardrobe' });
            wardrobe = [];
            renderWardrobe();
            document.getElementById('itemCount').textContent = '0';
        });
    }
}

// ── View Switcher ─────────────────────────────────────────────
function bindViewSwitcher() {
    const switcher = document.getElementById('viewSwitcher');
    if (!switcher) return;

    const tabs = switcher.querySelectorAll('.view-switcher__tab');
    const slider = document.getElementById('viewSlider');

    function updateSlider() {
        const activeTab = switcher.querySelector('.view-switcher__tab--active');
        if (activeTab && slider) {
            slider.style.width = activeTab.offsetWidth + 'px';
            slider.style.transform = `translateX(${activeTab.offsetLeft - 4}px)`;
        }
    }

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const view = tab.dataset.view;
            if (view === activeView) return;
            switchView(view);
        });
    });

    // Initial slider position
    requestAnimationFrame(updateSlider);
    window.addEventListener('resize', updateSlider);
}

function switchView(view) {
    activeView = view;
    const switcher = document.getElementById('viewSwitcher');
    const slider = document.getElementById('viewSlider');
    const tabs = switcher.querySelectorAll('.view-switcher__tab');

    tabs.forEach(t => t.classList.toggle('view-switcher__tab--active', t.dataset.view === view));

    const activeTab = switcher.querySelector('.view-switcher__tab--active');
    if (activeTab && slider) {
        slider.style.width = activeTab.offsetWidth + 'px';
        slider.style.transform = `translateX(${activeTab.offsetLeft - 4}px)`;
    }

    const wardrobeSection = document.getElementById('wardrobeSection');
    const outfitSection = document.getElementById('outfitSection');

    if (view === 'wardrobe') {
        wardrobeSection.style.display = '';
        outfitSection.style.display = 'none';
    } else {
        wardrobeSection.style.display = 'none';
        outfitSection.style.display = 'block';
    }
}

function updateOutfitBadge() {
    const badge = document.getElementById('outfitBadge');
    if (!badge) return;
    if (outfits.length > 0) {
        badge.textContent = outfits.length;
        badge.style.display = '';
    } else {
        badge.style.display = 'none';
    }
}

function onDateChanged() {
    if (userLocation) fetchWeather(userLocation.lat, userLocation.lng, selectedDate);
    updateGenerateBtn();
}

// ── Calendar ───────────────────────────────────────────────────
function renderCalendar() {
    const container = document.getElementById('calendarDays');
    container.innerHTML = '';

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Start from Monday of the current offset week
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay() + 1 + (calendarOffset * 7));

    const dayNames = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

    for (let i = 0; i < 7; i++) {
        const date = new Date(startOfWeek);
        date.setDate(startOfWeek.getDate() + i);

        const day = document.createElement('button');
        day.className = 'calendar-day';

        const isToday = date.getTime() === today.getTime();
        const isSelected = date.toDateString() === selectedDate.toDateString();

        if (isToday) day.classList.add('calendar-day--today');
        if (isSelected) day.classList.add('calendar-day--selected');

        day.innerHTML = `
            <span class="calendar-day__name">${dayNames[i]}</span>
            <span class="calendar-day__num">${date.getDate()}</span>
        `;

        day.addEventListener('click', () => {
            selectedDate = new Date(date);
            renderCalendar();
            onDateChanged();
        });

        container.appendChild(day);
    }
}

// ── Location & Weather ─────────────────────────────────────────
function tryLoadCachedLocation() {
    chrome.storage.local.get('yucart_location', (result) => {
        if (result.yucart_location) {
            userLocation = result.yucart_location;
            const btn = document.getElementById('locationBtn');
            btn.textContent = 'Update';
            document.getElementById('weatherCard').classList.add('context-chip--active');
            fetchWeather(userLocation.lat, userLocation.lng, selectedDate);
            updateGenerateBtn();
        }
    });
}

function requestLocation() {
    const btn = document.getElementById('locationBtn');
    const text = document.getElementById('locationText');
    btn.textContent = 'Locating...';
    btn.disabled = true;

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            // Cache location
            chrome.storage.local.set({ yucart_location: userLocation });
            text.textContent = 'Fetching weather...';
            btn.textContent = 'Update';
            btn.disabled = false;
            document.getElementById('weatherCard').classList.add('context-chip--active');
            fetchWeather(userLocation.lat, userLocation.lng, selectedDate);
            updateGenerateBtn();
        },
        () => {
            text.textContent = 'Location denied';
            btn.textContent = 'Retry';
            btn.disabled = false;
        },
        { enableHighAccuracy: false, timeout: 10000 }
    );
}

async function fetchWeather(lat, lng, date) {
    const text = document.getElementById('locationText');
    const dateStr = date.toISOString().split('T')[0];

    try {
        const res = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
            `&daily=temperature_2m_max,temperature_2m_min,weathercode` +
            `&start_date=${dateStr}&end_date=${dateStr}&timezone=auto`
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        const daily = data.daily;
        if (daily && daily.temperature_2m_max?.length > 0) {
            const high = Math.round(daily.temperature_2m_max[0]);
            const low = Math.round(daily.temperature_2m_min[0]);
            const code = daily.weathercode[0];
            const condition = weatherCodeToText(code);
            const icon = weatherCodeToIcon(code);

            weatherData = { high, low, condition, icon };
            text.innerHTML = `${icon} ${high}° / ${low}° &middot; ${condition}`;
            document.getElementById('weatherCard').classList.add('context-chip--active');
        }
    } catch (err) {
        console.error('[YuCart Wardrobe] Weather fetch failed:', err);
        text.textContent = `${lat.toFixed(2)}, ${lng.toFixed(2)}`;
    }
}

function weatherCodeToText(code) {
    const map = {
        0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
        45: 'Fog', 48: 'Rime fog',
        51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
        61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
        66: 'Freezing rain', 67: 'Heavy freezing rain',
        71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
        80: 'Light showers', 81: 'Showers', 82: 'Heavy showers',
        85: 'Light snow showers', 86: 'Heavy snow showers',
        95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Severe thunderstorm'
    };
    return map[code] || 'Unknown';
}

function weatherCodeToIcon(code) {
    if (code === 0) return '☀️';
    if (code <= 2) return '⛅';
    if (code === 3) return '☁️';
    if (code <= 48) return '🌫️';
    if (code <= 55) return '🌦️';
    if (code <= 67) return '🌧️';
    if (code <= 77) return '❄️';
    if (code <= 82) return '🌧️';
    if (code <= 86) return '🌨️';
    return '⛈️';
}

// ── Generate Outfit ────────────────────────────────────────────
function updateGenerateBtn() {
    const btn = document.getElementById('generateBtn');
    btn.disabled = wardrobe.length < 2;
}



async function generateOutfit() {
    const btn = document.getElementById('generateBtn');
    const btnText = document.getElementById('generateBtnText');
    const loadingBar = document.getElementById('aiLoadingBar');

    if (!settings.aiProvider || !settings.aiApiKey) {
        alert('Please configure an AI provider and API key in YuCart Settings first.');
        return;
    }

    btn.disabled = true;
    btnText.textContent = 'Generating...';
    loadingBar.classList.add('loading-track--active');

    try {
        const dateStr = selectedDate.toLocaleDateString('en-US', {
            weekday: 'long', month: 'long', day: 'numeric'
        });

        let contextParts = [`Date: ${dateStr}`];

        if (weatherData) {
            contextParts.push(`Weather: ${weatherData.condition}, High ${weatherData.high}°C / Low ${weatherData.low}°C`);
        } else if (userLocation) {
            contextParts.push(`Location coordinates: ${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)} (infer the weather, climate, and temperature for this location and date)`);
        }

        const context = contextParts.join('\n');

        let outfitData;
        if (settings.aiProvider === 'gemini') {
            outfitData = await generateOutfitGemini(context);
        } else {
            outfitData = await generateOutfitText(context);
        }

        if (outfitData && outfitData.length > 0) {
            for (const outfit of outfitData) {
                await chrome.runtime.sendMessage({ action: 'saveOutfit', outfit });
            }
            await loadOutfits();
            switchView('outfits');
            renderOutfits();
        }
    } catch (err) {
        console.error('[YuCart Wardrobe] Outfit generation failed:', err);
        alert('Outfit generation failed: ' + err.message);
    } finally {
        btn.disabled = false;
        btnText.textContent = 'Generate Outfit';
        loadingBar.classList.remove('loading-track--active');
        updateGenerateBtn();
    }
}

async function generateOutfitGemini(context) {
    const parts = [];

    parts.push({
        text: `You are a fashion stylist creating outfits from a user's wardrobe. Consider the context below when choosing items and styling.

Context:
${context}

Rules:
- Create exactly 1 outfit using ONLY items from the wardrobe below
- The outfit should have 2-5 items that work well together
- Consider weather/climate based on the location and date
- Provide: a creative name, occasion tag, the item IDs used, and brief styling notes
- Think about color coordination, layering for weather, and occasion appropriateness

Respond with ONLY a JSON array containing one object, no markdown fences:
[{"name":"Outfit Name","occasion":"casual/formal/smart-casual/streetwear","items":["id1","id2"],"notes":"Brief styling note"}]

Wardrobe items:`
    });

    // Add each wardrobe item with image
    for (const item of wardrobe) {
        parts.push({
            text: `\n--- Item ---\nID: ${item.id}\nName: ${item.title}\nVendor: ${item.vendor}`
        });

        if (item.thumbnail) {
            try {
                const base64 = item.thumbnail.startsWith('data:')
                    ? item.thumbnail.split(',')[1]
                    : await fetchImageAsBase64(item.thumbnail);
                if (base64) {
                    parts.push({
                        inline_data: {
                            mime_type: 'image/jpeg',
                            data: base64
                        }
                    });
                }
            } catch { /* skip image */ }
        }
    }

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${settings.aiApiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts }],
                generationConfig: { maxOutputTokens: 4096, temperature: 0.7 }
            })
        }
    );

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `Gemini HTTP ${response.status}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return parseOutfitResponse(text);
}

async function generateOutfitText(context) {
    const wardrobeList = wardrobe.map(item =>
        `ID: ${item.id} | Name: ${item.title} | Vendor: ${item.vendor}`
    ).join('\n');

    const prompt = `You are a fashion stylist creating outfits from a user's wardrobe.

Context:
${context}

Wardrobe items:
${wardrobeList}

Rules:
- Create exactly 1 outfit using ONLY items from the wardrobe
- The outfit should have 2-5 items that work well together
- Consider weather/climate based on location and date
- Think about color coordination, layering for weather, and occasion

Respond with ONLY a JSON array containing one object, no markdown:
[{"name":"Outfit Name","occasion":"casual/formal/smart-casual/streetwear","items":["id1","id2"],"notes":"Brief styling note"}]`;

    const isOpenRouter = settings.aiProvider === 'openrouter';
    const endpoint = isOpenRouter
        ? 'https://openrouter.ai/api/v1/chat/completions'
        : 'https://api.openai.com/v1/chat/completions';

    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.aiApiKey}`
    };

    if (isOpenRouter) {
        headers['HTTP-Referer'] = 'https://yupoo.com';
        headers['X-Title'] = 'YuCart Extension';
    }

    const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            model: isOpenRouter ? 'z-ai/glm-4.5-air:free' : 'gpt-3.5-turbo',
            messages: [
                { role: 'system', content: 'You are a fashion stylist. You respond with valid JSON only.' },
                { role: 'user', content: prompt }
            ],
            max_tokens: 2000,
            temperature: 0.7
        })
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    return parseOutfitResponse(text);
}

function parseOutfitResponse(text) {
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start === -1 || end === -1) throw new Error('No JSON array found in response');

    const jsonStr = text.substring(start, end + 1);
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) throw new Error('Response is not an array');

    return parsed.map(outfit => {
        const matchedItems = (outfit.items || [])
            .map(id => wardrobe.find(w => w.id === id))
            .filter(Boolean);

        return {
            name: String(outfit.name || 'Outfit').slice(0, 50),
            occasion: String(outfit.occasion || 'casual').slice(0, 30),
            items: matchedItems.map(item => ({
                id: item.id,
                title: item.title,
                thumbnail: item.thumbnail,
                vendor: item.vendor
            })),
            dateContext: selectedDate.toISOString()
        };
    }).filter(o => o.items.length >= 2);
}

async function fetchImageAsBase64(url) {
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64 = reader.result.split(',')[1];
                resolve(base64);
            };
            reader.readAsDataURL(blob);
        });
    } catch {
        return null;
    }
}

// ── Render Wardrobe Grid ───────────────────────────────────────
function renderWardrobe() {
    const grid = document.getElementById('wardrobeGrid');
    const empty = document.getElementById('wardrobeEmpty');
    const clearBtn = document.getElementById('clearWardrobeBtn');
    const countEl = document.getElementById('wardrobeCount');

    if (wardrobe.length === 0) {
        grid.style.display = 'none';
        empty.style.display = 'flex';
        if (clearBtn) clearBtn.style.display = 'none';
        if (countEl) countEl.textContent = '';
        return;
    }

    grid.style.display = 'grid';
    empty.style.display = 'none';
    if (clearBtn) clearBtn.style.display = 'flex';
    if (countEl) countEl.textContent = `${wardrobe.length}`;

    grid.innerHTML = wardrobe.map(item => `
        <div class="wardrobe-item" data-id="${item.id}">
            <img class="wardrobe-item__img" src="${item.thumbnail || ''}" alt="${item.title}" loading="lazy">
            <div class="wardrobe-item__info">
                <div class="wardrobe-item__name" title="${item.title}">${item.title}</div>
                <div class="wardrobe-item__vendor">${item.vendor}</div>
            </div>
            <div class="wardrobe-item__overlay">
                <button class="wardrobe-item__remove" data-id="${item.id}" title="Remove from wardrobe">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                        stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
        </div>
    `).join('');

    // Bind remove buttons
    grid.querySelectorAll('.wardrobe-item__remove').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            await chrome.runtime.sendMessage({ action: 'removeFromWardrobe', itemId: id });
            wardrobe = wardrobe.filter(i => i.id !== id);
            renderWardrobe();
            updateGenerateBtn();
            document.getElementById('itemCount').textContent = wardrobe.length;
        });
    });

    // Click item to open URL
    grid.querySelectorAll('.wardrobe-item').forEach(el => {
        el.addEventListener('click', () => {
            const item = wardrobe.find(i => i.id === el.dataset.id);
            if (item?.url) window.open(item.url, '_blank');
        });
    });
}

// ── Render Outfits ─────────────────────────────────────────────
function renderOutfits() {
    const section = document.getElementById('outfitSection');
    const list = document.getElementById('outfitList');
    const emptyEl = document.getElementById('outfitEmpty');

    updateOutfitBadge();

    if (outfits.length === 0) {
        list.innerHTML = '';
        if (emptyEl) emptyEl.style.display = 'flex';
        // Keep section visible if it's the active view
        if (activeView === 'outfits') {
            section.style.display = 'block';
        }
        return;
    }

    if (emptyEl) emptyEl.style.display = 'none';
    if (activeView === 'outfits') {
        section.style.display = 'block';
    }
    list.innerHTML = outfits.map(outfit => `
        <div class="outfit-card" data-id="${outfit.id}">
            <div class="outfit-card__header">
                <span class="outfit-card__name">${outfit.name}</span>
                <span class="outfit-card__occasion">${outfit.occasion}</span>
            </div>
            <div class="outfit-card__mannequin">
                <div class="stick-figure">
                    <div class="stick-figure__head"></div>
                    <div class="stick-figure__body"></div>
                    <div class="stick-figure__arm stick-figure__arm--left"></div>
                    <div class="stick-figure__arm stick-figure__arm--right"></div>
                    <div class="stick-figure__leg stick-figure__leg--left"></div>
                    <div class="stick-figure__leg stick-figure__leg--right"></div>
                </div>
                <div class="outfit-card__items">
                    ${(outfit.items || []).map((item, index) => `
                        <div class="outfit-card__item" style="z-index: ${outfit.items.length - index}">
                            <img class="outfit-card__thumb" src="${item.thumbnail || ''}" alt="${item.title}" loading="lazy">
                        </div>
                    `).join('')}
                </div>
            </div>
            <div class="outfit-card__info">
                ${(outfit.items || []).map(item => `
                    <div class="outfit-card__product">
                        <div class="outfit-card__product-title">${item.title}</div>
                        <div class="outfit-card__product-vendor">${item.vendor || ''}</div>
                    </div>
                `).join('')}
            </div>
            <div class="outfit-card__actions">
                <button class="btn--delete outfit-delete" data-id="${outfit.id}">Delete</button>
            </div>
        </div>
    `).join('');

    // Bind delete buttons
    list.querySelectorAll('.outfit-delete').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.id;
            await chrome.runtime.sendMessage({ action: 'deleteOutfit', outfitId: id });
            outfits = outfits.filter(o => o.id !== id);
            renderOutfits();
        });
    });
}
