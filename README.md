# YuCart — Yupoo Shopping Cart
https://hotdog-official.x.yupoo.com/albums
![Version](https://img.shields.io/badge/version-2.0-blue.svg)

A Chrome extension that enhances the shopping experience on Yupoo for international fashion shoppers. Built for the FashionReps community and anyone who browses Yupoo stores and purchases through shopping agents like Superbuy, AllChinaBuy, KakoBuy, Sugargoo, ACBuy, Mulebuy, and OOPBUY.

## Why YuCart?

Whenever I get a haul together, I usually open Notepad and paste links in or just add items to my agent's cart. However, because stores often blur and censor item names, I wouldn't be able to identify what I put in my cart a week ago. I created YuCart as my fix for this problem, allowing for better organization and clarity when shopping on Yupoo.

## Features

### Shopping Cart
- Add items directly from Yupoo product pages with one click
- Cart organized by vendor with quantity controls
- Persistent storage across browser sessions
- Export cart summary to clipboard

### Price Detection & Currency Conversion
- Automatically detects prices in multiple CNY formats (¥, Yuan, 元, P)
- Real-time exchange rate conversion to 25+ currencies
- Cached rates with 6-hour refresh

### AI Product Name Cleaning
- Clean up obscured/censored product names using AI
- Supports **Google Gemini** (with image recognition), **OpenAI**, and **OpenRouter**
- Batch cleaning with visual loading animations
- Gemini uses product images for more accurate identification

### Agent Checkout
- One-click checkout to **Superbuy**, **AllChinaBuy**, **KakoBuy**, **Sugargoo**, **ACBuy**, **Mulebuy**, **OOPBUY**, or raw links
- Automatically extracts Weidian/Taobao source links from product pages
- Opens agent pages and clicks "Add to Cart" automatically
- Progress tracking with success/failure feedback
- Disclosed affiliate checkout/support links for supported agents

### Wardrobe & AI Outfit Generation
- Save purchased items to your personal wardrobe
- AI-powered outfit generation creates fashionable combinations from your wardrobe
- Gemini Vision analyzes product images for color and style coordination
- Text-based fallback for OpenAI/OpenRouter users
- Visual outfit cards with thumbnail collages and styling notes
- Save and manage your favorite outfit combinations

### Dark Mode
- Seamless dark theme applied to Yupoo pages
- Enabled by default with option to disable

## Demo

[![Watch the video](https://img.youtube.com/vi/9zE3h39bgE4/0.jpg)](https://www.youtube.com/watch?v=9zE3h39bgE4)

## Installation

1. Clone or download this repository
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the project folder
5. The YuCart icon will appear in your toolbar

## To-Do List
- [x] Add support for more agents
- [x] Add a checkout option that adds all products to your selected agent
- [x] Add wardrobe feature with AI outfit generation

## Support

If you find this extension helpful, consider supporting its development. YuCart may earn a commission if you use clearly disclosed agent links from the extension's checkout or support settings.
