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
let navDebounceTimer = null;
let badgeGuardTimer = null;

const observer = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    removeBadge();
    clearTimeout(navDebounceTimer);
    navDebounceTimer = setTimeout(async () => {
      const { licenseStatus } = await chrome.storage.local.get('licenseStatus');
      if (!licenseStatus?.valid) return;
      console.log('[ClientID] URL changed, re-injecting badge for:', location.href);
      injectBadgeIfCustomerPage();
      injectBadgeIfInvoicePage();
    }, 800);
    return;
  }

  // If badge was removed by QB re-render, re-inject it
  if (!document.getElementById(BADGE_ID)) {
    clearTimeout(badgeGuardTimer);
    badgeGuardTimer = setTimeout(() => {
      if (!document.getElementById(BADGE_ID)) {
        injectBadgeIfCustomerPage();
        injectBadgeIfInvoicePage();
      }
    }, 500);
  }
});

// document_start means body may not exist yet — wait for it
function startObserver() {
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }
}

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
  if (!isCustomerPage()) {
    console.log('[ClientID] Not a customer page, skipping');
    return;
  }
  const customerId = getCustomerIdFromUrl();
  console.log('[ClientID] Customer page detected, ID from URL:', customerId);
  if (!customerId) return;

  let attempts = 0;
  const maxAttempts = 30;

  const poll = setInterval(() => {
    attempts++;

    if (document.getElementById(BADGE_ID)) {
      clearInterval(poll);
      return;
    }

    // Wait for customer name element — class differs between sandbox and production
    const nameEl =
      document.querySelector('[data-testid="stageData-name"]') ||
      document.querySelector('[class*="StageDataV2__Name-"]') ||
      document.querySelector('[class*="StageData__Name"]');

    const headerWrapper = nameEl ? nameEl.parentElement : null;

    console.log(`[ClientID] Poll attempt ${attempts}, header found:`, !!headerWrapper);

    if (headerWrapper) {
      clearInterval(poll);
      insertBadge(customerId, nameEl, false);
      return;
    }

    if (attempts >= maxAttempts) {
      clearInterval(poll);
      console.log('[ClientID] Max attempts reached, using fixed fallback');
      // Last resort — inject at top of body
      if (!document.getElementById(BADGE_ID)) {
        const fixed = document.createElement('div');
        fixed.id = BADGE_ID;
        fixed.style.cssText = 'position:fixed;top:70px;right:20px;z-index:99999;';
        fixed.innerHTML = `
          <span class="clientid-label">Customer ID</span>
          <span class="clientid-value">${customerId}</span>
          <button class="clientid-copy" title="Copy Customer ID">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
        `;
        fixed.querySelector('.clientid-copy').addEventListener('click', () => {
          navigator.clipboard.writeText(customerId);
        });
        document.body.appendChild(fixed);
      }
    }
  }, 500);
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

  let attempts = 0;
  const maxAttempts = 20;

  const poll = setInterval(async () => {
    attempts++;

    if (document.getElementById(BADGE_ID)) {
      clearInterval(poll);
      return;
    }

    const input =
      document.querySelector('[name="customer_name"]') ||
      document.querySelector('.nameInput input') ||
      document.querySelector('[class*="rethinkCustomerContainer"] input') ||
      document.querySelector('[class*="txp-capability-rethinkCustomer"] input');
    const customerName = input?.value?.trim();

    if (customerName) {
      clearInterval(poll);
      const customerId = await getCustomerIdByName(customerName);
      if (!customerId) {
        console.log('[ClientID] No Customer ID found for:', customerName);
        return;
      }
      const anchor = input.closest('div') || input.parentElement;
      insertBadge(customerId, anchor);
      return;
    }

    if (attempts >= maxAttempts) {
      clearInterval(poll);
      console.log('[ClientID] Gave up waiting for customer name on invoice page');
    }
  }, 500);
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

// Wait for DOM to be ready before injecting badge
async function bootstrap() {
  const { licenseStatus } = await chrome.storage.local.get('licenseStatus');
  if (!licenseStatus?.valid) {
    console.log('[ClientID] License not active, skipping badge injection');
    return;
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}

bootstrap();
startObserver();
