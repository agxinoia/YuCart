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

## Contributing

- Feel free to open issues or pull requests. Describe the behavior you want (automatic detection, batch add, export formats like CSV/JSON).
- If you add new features, update this README to reflect new files, permissions, and usage steps.

## License

Include your preferred license here (e.g., MIT) or remove this section if you don't want a license in the repository.
