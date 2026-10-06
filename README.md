# YuCart

Yupoo Shopping Cart Chrome Extension

A small Chrome extension that helps collect products from Yupoo pages into a lightweight shopping cart for easier review and purchase.

## Problem it solves

- Yupoo pages often list many products across multiple pages or albums. Manually keeping track of items you want to buy is tedious and error-prone.
- This extension provides a quick, local cart to collect product links, thumbnails, titles, and basic metadata while you browse, so you can review and export selections later.

## Workflow

1. Install the extension in Chrome (load unpacked or install packed CRX depending on your setup).
2. While browsing Yupoo, open the extension popup or use the provided toolbar button.
3. Click the action to add the currently viewed product (or selected items) to the local cart. The extension captures the product title, URL, thumbnail (when available), and optional notes.
4. Open the cart from the extension popup to review, remove, or edit items.
5. Export or copy the cart contents for sharing or for checkout in a purchase flow.

> Note: Exact behavior depends on the implementation of content scripts and popup UI. If you want the extension to automatically detect products on a page or support batch selection, we can extend the content script logic to parse Yupoo album layouts.

## Layout

This project is a Chrome extension and typically follows this layout (update to match the repo if different):

- manifest.json — Chrome extension manifest and permissions.
- popup.html / popup.js — UI for the extension popup where the cart is displayed and managed.
- content_script.js — Script injected into Yupoo pages to detect product information and support "Add to cart" actions.
- background.js — Background or service worker (optional) for persistent tasks or handling messaging across parts of the extension.
- styles/*.css — Styling for popup and any injected UI.
- icons/* — Extension icons in multiple sizes.

If your repo structure differs, replace the above entries with the actual file names and paths.

## Installation (development)

1. Clone the repo:

   git clone https://github.com/agxinoia/YuCart.git

2. Open Chrome and go to chrome://extensions
3. Enable "Developer mode" then click "Load unpacked" and select the repository folder (or the build/ directory if you have a build step).

## Usage

- Open the extension popup while on a Yupoo product/album page and click "Add" to add items to your cart.
- Open the cart in the popup to manage and export items.

## Taobao AU Free Shipping Finder (beta)

Taobao's Global Free Shipping Plan (全球包邮计划) ships free to Australia once an order reaches ¥249. Sellers opt in, and their qualifying listings show a "境外满包邮" tag when your Taobao delivery address is in Australia. YuCart can check for that tag so you can tell which suppliers take part.

1. Log in to Taobao in Chrome and set your delivery address to Australia.
2. In YuCart settings, switch on **Taobao AU Free Shipping Finder (Beta)**, allow the taobao.com / tmall.com / tb.cn / reddit.com access it asks for, and save.
3. Check sellers:
   - **Yupoo album page**: the pill next to Add to Cart checks that album's Taobao link.
   - **Any Yupoo store page**: the chip in the bottom-left checks the seller, reading up to 3 Taobao links from their albums. A seller counts as eligible if any of them has the tag.
   - **r/FashionReps wiki** (or any subreddit wiki): every Taobao shop/item and Yupoo store link gets a badge. Click one badge, or use **Check unchecked** to work through the page.
4. Eligible sellers are listed in settings under **Free Shipping to Australia**.

Each check opens the listing in a background tab, so it uses your own Taobao session. If Taobao asks you to log in or shows its verification slider, that tab is left open for you; finish it there and check again. Results are stored locally in `chrome.storage.local`. The tag text the checker looks for is in `shared/au-freeship.js` (`LABEL_PATTERNS`) if Taobao changes its wording.

## Contributing

- Feel free to open issues or pull requests. Describe the behavior you want (automatic detection, batch add, export formats like CSV/JSON).
- If you add new features, update this README to reflect new files, permissions, and usage steps.

## License

Include your preferred license here (e.g., MIT) or remove this section if you don't want a license in the repository.
