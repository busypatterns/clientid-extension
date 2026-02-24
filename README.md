# ClientID for QuickBooks — Chrome Extension

The Chrome extension that injects client IDs directly into QuickBooks Online.
No QB data leaves the user's browser. License validation is the only server call.

---

## How It Works

1. User installs extension from Chrome Web Store
2. User enters license key in the popup (obtained after subscribing on your site)
3. Extension validates key against your server — if valid, it activates
4. Extension runs invisibly inside QuickBooks Online:
   - Intercepts QB's own internal API calls to capture customer data
   - Injects a read-only "Client ID" badge into customer detail pages
   - Injects the Client ID onto invoice pages
   - Watches for QB page navigation (it's a SPA) and re-injects as needed
5. License is re-validated every 24 hours silently in the background

---

## Setup Before Publishing

### 1. Update SERVER_URL
In two files, replace `your-railway-url.up.railway.app` with your actual Railway URL:
- `background/service-worker.js` — line 6
- `popup/popup.js` — line 3

### 2. Update site URLs
In `popup/popup.html`, replace `your-site-url.com` with your actual domain:
- The "Subscribe Now" link
- The "Support" and "Privacy" footer links
- The dashboard link

### 3. Add Icons
Create PNG icons and place them in `assets/`:
- `icon16.png` — 16×16px
- `icon48.png` — 48×48px  
- `icon128.png` — 128×128px

Use QuickBooks green (#2ca01c) as the base color for brand consistency.
Free tool: https://www.canva.com or https://icon.kitchen

---

## Testing Locally (Before Publishing)

1. Open Chrome → go to `chrome://extensions`
2. Enable **Developer Mode** (top right toggle)
3. Click **Load unpacked**
4. Select this entire `clientid-extension` folder
5. Open QuickBooks Online and navigate to a customer
6. Click the extension icon — enter a valid license key
7. You should see the Client ID badge appear on customer pages

---

## Publishing to Chrome Web Store

1. Zip the entire extension folder (not the parent, just this folder's contents)
2. Go to https://chrome.google.com/webstore/devconsole
3. Pay the one-time $5 developer fee if not already done
4. Click **Add new item** → upload the zip
5. Fill in:
   - Name: `ClientID for QuickBooks`
   - Description: explain the problem it solves
   - Category: `Productivity`
   - Screenshots: take them inside QuickBooks showing the badge
6. Submit for review — Google typically approves in 1-3 business days

---

## File Structure

```
clientid-extension/
├── manifest.json          ← Extension config, permissions, entry points
├── background/
│   └── service-worker.js  ← License validation, alarm scheduling
├── content/
│   ├── content.js         ← QB page injection, API interception
│   └── content.css        ← Styling for injected Client ID badge
├── popup/
│   ├── popup.html         ← Extension popup UI
│   ├── popup.css          ← Popup styles
│   └── popup.js           ← Popup logic
└── assets/
    ├── icon16.png         ← ADD THESE
    ├── icon48.png
    └── icon128.png
```

---

## Intuit Certification (After Launch)

Once you have real users, apply at:
https://developer.intuit.com/app/developer/qbo/docs/go-live

You'll need:
- A privacy policy URL
- A support URL
- Screenshots of the extension working
- Description of what data you access (answer: none — the extension reads QB's own page)
- Active users help your application — get some paying customers first
