// content/content.js
// Injected directly into QuickBooks Online pages.
// This script:
// 1. Checks license is valid before doing anything
// 2. Detects what QB page the user is on (customer detail, invoice, customer list)
// 3. Extracts the internal QB customer ID from the page/network requests
// 4. Injects a read-only "Client ID" field into the UI
// 5. Watches for page navigation (QB is a SPA) and re-runs on new pages
// 6. Intercepts QB API responses to grab customer IDs reliably

(async function () {
  'use strict';

  // ─── License Check ──────────────────────────────────────────────────────────
  const { licenseStatus } = await chrome.runtime.sendMessage({ type: 'CHECK_LICENSE' });
  if (!licenseStatus?.valid) {
    console.log('[ClientID] License not valid — extension inactive.', licenseStatus?.reason);
    return;
  }

  console.log('[ClientID] License valid. Extension active.');

  // ─── State ──────────────────────────────────────────────────────────────────
  let currentCustomerId = null;
  let currentUrl = location.href;
  let observer = null;

  // ─── QB API Interception ─────────────────────────────────────────────────────
  // We intercept QB's own XHR/fetch calls to capture customer data reliably.
  // QB Online's internal REST API returns customer objects with the `Id` field.
  // We hook into this before the page fully renders.

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

    // Look for QB customer API responses
    if (url.includes('/v3/company/') && url.includes('/customer/')) {
      try {
        const clone = response.clone();
        const data = await clone.json();

        // Single customer response
        if (data?.Customer?.Id) {
          handleCustomerData(data.Customer);
        }
        // Customer list response
        if (data?.QueryResponse?.Customer) {
          data.QueryResponse.Customer.forEach(handleCustomerData);
        }
      } catch (e) {
        // Not JSON or not a customer response — ignore
      }
    }
    return response;
  };

  // XHR interception (QB uses both fetch and XHR)
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._url = url;
    return originalXHROpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('load', function () {
      if (this._url && this._url.includes('/v3/company/') && this._url.includes('/customer/')) {
        try {
          const data = JSON.parse(this.responseText);
          if (data?.Customer?.Id) handleCustomerData(data.Customer);
          if (data?.QueryResponse?.Customer) {
            data.QueryResponse.Customer.forEach(handleCustomerData);
          }
        } catch (e) {}
      }
    });
    return originalXHRSend.apply(this, arguments);
  };

  // ─── Customer ID Cache ───────────────────────────────────────────────────────
  // Store customer IDs we've seen keyed by QB's display name + company name
  // so we can look them up when we find a customer on screen
  const customerCache = new Map(); // Map<customerId, customerData>
  const nameToIdCache = new Map(); // Map<displayName, customerId>

  function handleCustomerData(customer) {
    if (!customer?.Id) return;
    customerCache.set(customer.Id, customer);
    if (customer.DisplayName) nameToIdCache.set(customer.DisplayName.toLowerCase(), customer.Id);
    if (customer.CompanyName) nameToIdCache.set(customer.CompanyName.toLowerCase(), customer.Id);

    // If we're currently on this customer's page, inject immediately
    if (isOnCustomerPage()) {
      const pageCustomerId = getCustomerIdFromUrl();
      if (pageCustomerId === customer.Id || pageCustomerId === null) {
        injectClientIdField(customer.Id, customer.DisplayName);
      }
    }
  }

  // ─── URL / Page Detection ────────────────────────────────────────────────────
function isOnCustomerPage() {
    return location.href.includes('customerdetail');
  }

  function isOnInvoicePage() {
    return location.href.includes('/app/invoice') ||
           location.href.includes('/app/recurrence');
  }

  function getCustomerIdFromUrl() {
    // QB Online puts the customer ID in the URL as a query param or path segment
    const params = new URLSearchParams(location.search);
    return params.get('nameId') || params.get('customerId') || null;
  }

  // ─── Inject Client ID Field ──────────────────────────────────────────────────
  function injectClientIdField(customerId, displayName) {
    if (!customerId) return;

    // Don't inject twice
    if (document.getElementById('ciqb-client-id-field')) {
      document.getElementById('ciqb-client-id-value').textContent = customerId;
      return;
    }

    // Find the best insertion point in QB's customer detail UI
    // QB renders customer info in a header section — we look for the name heading
    const insertionPoints = [
      '.customer-header',
      '[data-testid="customer-name"]',
      '.entity-header',
      '.customerHeaderContainer',
      'h1.entity-name',
      '.customer-details-header',
    ];

    let targetEl = null;
    for (const selector of insertionPoints) {
      targetEl = document.querySelector(selector);
      if (targetEl) break;
    }

    if (!targetEl) {
      // QB hasn't rendered the customer UI yet — try again shortly
      setTimeout(() => injectClientIdField(customerId, displayName), 800);
      return;
    }

    const badge = document.createElement('div');
    badge.id = 'ciqb-client-id-field';
    badge.className = 'ciqb-badge';
    badge.innerHTML = `
      <span class="ciqb-label">Client ID</span>
      <span class="ciqb-value" id="ciqb-client-id-value">${customerId}</span>
      <button class="ciqb-copy-btn" title="Copy Client ID" data-id="${customerId}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
      </button>
    `;

    // Insert after the target element
    targetEl.insertAdjacentElement('afterend', badge);

    // Copy button handler
    badge.querySelector('.ciqb-copy-btn').addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.id;
      navigator.clipboard.writeText(id).then(() => {
        const btn = e.currentTarget;
        btn.classList.add('ciqb-copied');
        setTimeout(() => btn.classList.remove('ciqb-copied'), 1500);
      });
    });

    currentCustomerId = customerId;
    console.log(`[ClientID] Injected Client ID: ${customerId} for ${displayName}`);
  }

  // ─── Invoice Injection ───────────────────────────────────────────────────────
  // On invoice pages, we look for the customer name QB has selected,
  // look up their ID from our cache, and inject it into the invoice memo area
  function injectOnInvoicePage() {
    if (document.getElementById('ciqb-invoice-field')) return;

    // QB invoice page shows the selected customer name
    const customerNameEl = document.querySelector(
      '[data-testid="customer-name-display"], .customer-name, .payerName'
    );
    if (!customerNameEl) {
      setTimeout(injectOnInvoicePage, 1000);
      return;
    }

    const customerName = customerNameEl.textContent.trim().toLowerCase();
    const customerId = nameToIdCache.get(customerName);

    if (!customerId) {
      // Customer not in cache yet — wait for API intercept to fire
      setTimeout(injectOnInvoicePage, 1200);
      return;
    }

    // Find invoice form area to inject into
    const invoiceHeader = document.querySelector('.invoice-header, .transaction-header, form');
    if (!invoiceHeader) return;

    const badge = document.createElement('div');
    badge.id = 'ciqb-invoice-field';
    badge.className = 'ciqb-badge ciqb-invoice-badge';
    badge.innerHTML = `
      <span class="ciqb-label">Client ID</span>
      <span class="ciqb-value" id="ciqb-invoice-client-id">${customerId}</span>
      <button class="ciqb-copy-btn" title="Copy Client ID" data-id="${customerId}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
      </button>
    `;

    invoiceHeader.insertAdjacentElement('afterbegin', badge);

    badge.querySelector('.ciqb-copy-btn').addEventListener('click', (e) => {
      navigator.clipboard.writeText(e.currentTarget.dataset.id).then(() => {
        e.currentTarget.classList.add('ciqb-copied');
        setTimeout(() => e.currentTarget.classList.remove('ciqb-copied'), 1500);
      });
    });
  }

  // ─── SPA Navigation Watcher ──────────────────────────────────────────────────
  // QB Online is a single-page app. The URL changes without full page reloads.
  // We watch for URL changes and re-run our injection logic.
  function watchNavigation() {
    // Check URL every 500ms — lightweight and reliable for SPAs
    setInterval(() => {
      if (location.href !== currentUrl) {
        currentUrl = location.href;
        currentCustomerId = null;

        // Clean up old injected elements
        document.getElementById('ciqb-client-id-field')?.remove();
        document.getElementById('ciqb-invoice-field')?.remove();

        // Re-run after a short delay to let QB render the new page
        setTimeout(runOnCurrentPage, 1000);
      }
    }, 500);

    // Also use MutationObserver to catch DOM changes on the same URL
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => {
      if (!document.getElementById('ciqb-client-id-field') && isOnCustomerPage()) {
        runOnCurrentPage();
      }
      if (!document.getElementById('ciqb-invoice-field') && isOnInvoicePage()) {
        runOnCurrentPage();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function runOnCurrentPage() {
    if (isOnCustomerPage()) {
      const customerId = getCustomerIdFromUrl();
      if (customerId && customerCache.has(customerId)) {
        const customer = customerCache.get(customerId);
        injectClientIdField(customer.Id, customer.DisplayName);
      } else {
        // Customer data not in cache yet — API intercept will trigger injection
        // when QB loads the customer data
        setTimeout(() => {
          if (!document.getElementById('ciqb-client-id-field')) {
            const customerId = getCustomerIdFromUrl();
            if (customerId && customerCache.has(customerId)) {
              const customer = customerCache.get(customerId);
              injectClientIdField(customer.Id, customer.DisplayName);
            }
          }
        }, 2000);
      }
    }

    if (isOnInvoicePage()) {
      injectOnInvoicePage();
    }
  }

  // ─── Init ────────────────────────────────────────────────────────────────────
  watchNavigation();
  runOnCurrentPage();

})();
