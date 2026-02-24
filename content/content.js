// content/content.js
// Injects a Customer ID badge on QuickBooks customer and invoice pages

const BADGE_ID = 'clientid-badge';
let lastUrl = location.href;

// ─── Main ─────────────────────────────────────────────────────────────────────
async function init() {
  injectBadgeIfCustomerPage();
  injectBadgeIfInvoicePage();
}

// ─── URL Watcher (QB is a SPA) ────────────────────────────────────────────────
const observer = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    removeBadge();
    injectBadgeIfCustomerPage();
    injectBadgeIfInvoicePage();
  }
});

observer.observe(document.body, { childList: true, subtree: true });

// ─── Customer Page ────────────────────────────────────────────────────────────
function getCustomerIdFromUrl() {
  const params = new URLSearchParams(location.search);
  const nameId = params.get('nameId');
  if (nameId) return nameId;
  const match = location.pathname.match(/\/customers\/(\d+)/);
  if (match) return match[1];
  return null;
}

function isCustomerPage() {
  return (
    location.pathname.includes('customerdetail') ||
    location.pathname.includes('/customers/')
  );
}

function injectBadgeIfCustomerPage() {
  if (!isCustomerPage()) return;
  const customerId = getCustomerIdFromUrl();
  if (!customerId) return;

  waitForElement('h1, [class*="CustomerHeader"], [class*="customer-header"], .customer-name')
    .then((anchor) => {
      if (document.getElementById(BADGE_ID)) return;
      insertBadge(customerId, anchor);
    })
    .catch(() => {
      const fallback = document.querySelector('main') || document.querySelector('#root');
      if (fallback && !document.getElementById(BADGE_ID)) {
        insertBadge(customerId, fallback, true);
      }
    });
}

// ─── Invoice Page ─────────────────────────────────────────────────────────────
function isInvoicePage() {
  return (
    location.pathname.includes('/invoice') ||
    location.search.includes('txnId')
  );
}

function injectBadgeIfInvoicePage() {
  if (!isInvoicePage()) return;

  waitForElement('[name="customer_name"]')
    .then(async (input) => {
      await waitForInputValue(input);

      const customerName = input.value?.trim();
      if (!customerName) return;
      if (document.getElementById(BADGE_ID)) return;

      const customerId = await getCustomerIdByName(customerName);
      if (!customerId) return;

      const anchor = input.closest('div') || input.parentElement;
      insertBadge(customerId, anchor);
    })
    .catch(() => {});
}

// Wait until an input has a non-empty value
function waitForInputValue(input, timeout = 5000) {
  return new Promise((resolve, reject) => {
    if (input.value?.trim()) return resolve();

    const interval = setInterval(() => {
      if (input.value?.trim()) {
        clearInterval(interval);
        resolve();
      }
    }, 200);

    setTimeout(() => {
      clearInterval(interval);
      reject(new Error('Timeout waiting for input value'));
    }, timeout);
  });
}

// Ask service worker for Customer ID by name
function getCustomerIdByName(customerName) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'GET_CUSTOMER_ID', customerName },
      (response) => {
        resolve(response?.customerId || null);
      }
    );
  });
}

// ─── Badge Injection ──────────────────────────────────────────────────────────
function insertBadge(customerId, anchor, prepend = false) {
  const badge = document.createElement('div');
  badge.id = BADGE_ID;
  badge.innerHTML = `
    <span class="clientid-label">Customer ID</span>
    <span class="clientid-value">${customerId}</span>
    <button class="clientid-copy" title="Copy Customer ID" aria-label="Copy Customer ID">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
    </button>
  `;

  badge.querySelector('.clientid-copy').addEventListener('click', () => {
    navigator.clipboard.writeText(customerId).then(() => {
      const btn = badge.querySelector('.clientid-copy');
      btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
      setTimeout(() => {
        btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
      }, 1500);
    });
  });

  if (prepend) {
    anchor.prepend(badge);
  } else {
    anchor.insertAdjacentElement('afterend', badge);
  }
}

function removeBadge() {
  const existing = document.getElementById(BADGE_ID);
  if (existing) existing.remove();
}

// ─── Utility: Wait for DOM element ───────────────────────────────────────────
function waitForElement(selector, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const el = document.querySelector(selector);
    if (el) return resolve(el);

    const obs = new MutationObserver(() => {
      const found = document.querySelector(selector);
      if (found) {
        obs.disconnect();
        resolve(found);
      }
    });

    obs.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      obs.disconnect();
      reject(new Error('Timeout: ' + selector));
    }, timeout);
  });
}

init();
