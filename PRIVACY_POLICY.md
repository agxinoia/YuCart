# Privacy Policy for YuCart

Effective date: March 18, 2026

YuCart ("we", "our", or "the extension") is a Chrome extension that helps users browse Yupoo listings, save items, organize a shopping cart, and use optional wardrobe and AI-assisted features.

This Privacy Policy explains what data YuCart handles, how that data is used, when it is shared, and what choices users have.

## 1. Data YuCart collects and processes

YuCart may collect or process the following categories of data:

- Product and shopping data you choose to save, such as product titles, prices, vendor names, product links, source links, thumbnails, quantities, and timestamps.
- Wardrobe and outfit data you choose to save, such as clothing item metadata, images, saved outfits, and related timestamps.
- Settings and preferences, such as target currency, dark mode, selected shopping agent, beta feature settings, popup scale, and AI provider selection.
- AI API credentials you provide, such as your own API key for OpenAI, OpenRouter, or Google Gemini. YuCart stores these keys locally on your device and does not intentionally sync them through Chrome sync storage.
- Location data only if you explicitly grant browser geolocation permission for the wardrobe weather feature. YuCart stores cached coordinates locally to reduce repeated prompts.
- Usage-generated metadata related to AI name-cleaning, such as original product names, cleaned names, store links, product links, vendor names, color, item type, and timestamps.
- Cached service data, such as exchange-rate data and update-check status.

## 2. How YuCart uses data

YuCart uses data to:

- Display and manage your local shopping cart.
- Save wardrobe items and generated outfits.
- Convert product prices using exchange-rate data.
- Generate optional AI-assisted product-name cleanup and outfit suggestions.
- Fetch optional weather context for wardrobe recommendations.
- Open and automate checkout flows on supported shopping-agent websites.
- Check whether a newer version of the extension is available.
- Improve product-name cleanup quality by storing cleaned-name records submitted through the extension.

## 3. Where data is stored

YuCart primarily stores user data in Chrome extension storage on the user's device.

- `chrome.storage.local` is used for cart contents, wardrobe items, saved outfits, cached location, exchange-rate cache, update-check cache, and local-only settings such as AI API keys.
- `chrome.storage.sync` may be used for non-sensitive settings and preferences that Chrome can sync across the user's signed-in browser profile.

Users can remove locally stored data by clearing the cart and wardrobe inside the extension, changing settings, or removing the extension.

## 4. When data is shared with third parties

YuCart shares data with third parties only when needed to provide a feature you use.

### AI providers

If you use AI features, YuCart sends relevant product or wardrobe data to the AI provider you selected:

- OpenAI
- OpenRouter
- Google Gemini

This may include product titles, vendor names, product links, source links, item IDs, thumbnails or wardrobe images, and prompt context you trigger through the extension. Your requests to these providers are governed by their own privacy policies and terms.

### Weather provider

If you grant location access for the wardrobe feature, YuCart sends your coordinates and requested date context to Open-Meteo to fetch weather data.

### Exchange-rate provider

YuCart fetches exchange-rate data from `open.er-api.com` to display converted prices.

### Update check

YuCart checks a version file hosted on GitHub to determine whether an update is available.

### Firestore / backend storage

When AI name-cleaning is used, YuCart uploads cleaned-name records to a Google Firestore project used by the extension. These uploaded records may include:

- Original product name
- Cleaned product name
- Store link
- Product/source link
- Vendor name
- Color
- Item type
- Timestamp

This backend storage is used to support and improve YuCart's cleaned-name dataset and related features.

### Supported shopping-agent sites

When you use checkout automation, YuCart opens or builds links for supported third-party agent sites and may include referral or affiliate parameters in those links, as disclosed in the extension settings.

## 5. What YuCart does not do

YuCart does not state that it sells personal data.

YuCart is not designed to collect:

- Payment card numbers
- Bank account information
- Government identification numbers
- Health information
- Precise location unless you explicitly grant location access for the weather feature

YuCart does not request location access unless you use the related wardrobe feature.

## 6. Data retention

Locally stored extension data remains on your device until you remove it, overwrite it, clear it through the extension, clear browser extension storage, or uninstall the extension.

Data uploaded to third-party providers or backend services may be retained according to those providers' own retention policies and operational needs.

## 7. Security

YuCart uses Chrome extension storage and standard HTTPS requests for supported remote services. However, no method of electronic storage or transmission is completely secure, and absolute security cannot be guaranteed.

Users are responsible for safeguarding any API keys they choose to enter into the extension.

## 8. Your choices

You can choose whether to:

- Save items to the cart or wardrobe
- Use AI-assisted features
- Provide an AI API key
- Grant location permission
- Use shopping-agent checkout automation

You can also uninstall the extension at any time to stop future collection and local storage by the extension.

## 9. Changes to this Privacy Policy

This Privacy Policy may be updated from time to time. When updated, the revised version should be published at the Privacy Policy URL provided for YuCart.

## 10. Contact

For questions about this Privacy Policy or YuCart, contact the developer via the YuCart GitHub repository or developer profile:

- https://github.com/agxinoia/YuCart
- https://github.com/agxinoia
