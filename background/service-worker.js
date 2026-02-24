// background/service-worker.js

const SERVER_URL = 'https://clientid-server-production.up.railway.app';
const VALIDATE_INTERVAL_MINUTES = 60 * 24;

// ─── On Install / Startup ────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[ClientID] Extension installed.');
  await validateLicense();
  setupAlarm();
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('[ClientID] Extension started.');
  await validateLicense();
  setupAlarm();
});

// ─── Alarm ───────────────────────────────────────────────────────────────────
function setupAlarm() {
  chrome.alarms.clearAll(() => {
    chrome.alarms.create('licenseCheck', {
      periodInMinutes: VALIDATE_INTERVAL_MINUTES,
    });
  });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'licenseCheck') await validateLicense();
});

// ─── License Validation ──────────────────────────────────────────────────────
async function validateLicense() {
  const { licenseKey } = await chrome.storage.local.get('licenseKey');
  if (!licenseKey) {
    await setLicenseStatus({ valid: false, reason: 'No license key entered.' });
    return;
  }
  try {
    const response = await fetch(`${SERVER_URL}/license/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey }),
    });
    const data = await response.json();
    await setLicenseStatus(data);
  } catch (err) {
    console.warn('[ClientID] License check failed:', err.message);
    const cached = await chrome.storage.local.get('licenseStatus');
    if (!cached.licenseStatus) {
      await setLicenseStatus({ valid: false, reason: 'Could not reach license server.' });
    }
  }
}

async function setLicenseStatus(status) {
  await chrome.storage.local.set({
    licenseStatus: status,
    licenseCheckedAt: Date.now(),
  });
}

// ─── QB OAuth Flow ───────────────────────────────────────────────────────────
let oauthTabHandled = false;

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url) return;
  if (oauthTabHandled) return;

  let pathname;
  try {
    const tabUrl = new URL(tab.url);
    const serverUrl = new URL(SERVER_URL);
    if (tabUrl.hostname !== serverUrl.hostname) return;
    pathname = tabUrl.pathname;
  } catch (e) {
    return;
  }

  if (pathname !== '/auth/qb/success') return;

  oauthTabHandled = true;
  console.log('[ClientID] QB OAuth success detected.');

  await chrome.storage.local.set({
    qbConnected: true,
    qbConnectedAt: Date.now(),
  });

  setTimeout(() => {
    chrome.tabs.remove(tabId).catch(() => {});
    oauthTabHandled = false;
  }, 3000);

  await triggerSync();
});

// ─── Sync ────────────────────────────────────────────────────────────────────
async function triggerSync() {
  const { licenseKey } = await chrome.storage.local.get('licenseKey');
  if (!licenseKey) return { success: false, error: 'No license key.' };

  await chrome.storage.local.set({
    syncStatus: 'syncing',
    syncStartedAt: Date.now(),
  });

  try {
    const response = await fetch(`${SERVER_URL}/auth/qb/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey }),
    });

    const data = await response.json();

    if (response.ok && data.success !== false) {
      // Store the customer name→ID map for invoice badge lookups
      if (data.customerMap) {
        await chrome.storage.local.set({ customerMap: data.customerMap });
        console.log('[ClientID] Customer map stored:', Object.keys(data.customerMap).length, 'entries');
      }

      await chrome.storage.local.set({
        syncStatus: 'success',
        syncCompletedAt: Date.now(),
        syncResult: data,
      });
      return { success: true, data };
    } else {
      const error = data.error || data.message || 'Sync failed.';
      await chrome.storage.local.set({ syncStatus: 'error', syncError: error });
      return { success: false, error };
    }
  } catch (err) {
    const error = 'Network error: ' + err.message;
    await chrome.storage.local.set({ syncStatus: 'error', syncError: error });
    return { success: false, error };
  }
}

// ─── Message Handler ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === 'CHECK_LICENSE') {
    chrome.storage.local.get(['licenseStatus']).then(({ licenseStatus }) => {
      sendResponse({ licenseStatus: licenseStatus || { valid: false } });
    });
    return true;
  }

  if (message.type === 'LICENSE_KEY_SAVED') {
    validateLicense().then(() => {
      chrome.storage.local.get('licenseStatus').then(({ licenseStatus }) => {
        sendResponse({ licenseStatus });
      });
    });
    return true;
  }

  if (message.type === 'GET_STATUS') {
    chrome.storage.local.get([
      'licenseStatus', 'licenseKey', 'licenseCheckedAt',
      'qbConnected', 'qbConnectedAt',
      'syncStatus', 'syncCompletedAt', 'syncError', 'syncResult',
    ]).then((data) => {
      sendResponse(data);
    });
    return true;
  }

  if (message.type === 'CONNECT_QB') {
    (async () => {
      try {
        const { licenseKey } = await chrome.storage.local.get('licenseKey');
        const response = await fetch(
          `${SERVER_URL}/auth/qb/connect-url?licenseKey=${encodeURIComponent(licenseKey)}`
        );
        const data = await response.json();
        if (data.url) {
          chrome.tabs.create({ url: data.url });
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: data.error || 'Could not get connect URL.' });
        }
      } catch (err) {
        sendResponse({ success: false, error: 'Network error: ' + err.message });
      }
    })();
    return true;
  }

  if (message.type === 'TRIGGER_SYNC') {
    triggerSync().then((result) => sendResponse(result));
    return true;
  }

  if (message.type === 'DISCONNECT_QB') {
    chrome.storage.local.set({
      qbConnected: false,
      qbConnectedAt: null,
      syncStatus: null,
      syncCompletedAt: null,
      syncError: null,
      syncResult: null,
      customerMap: null,
    }).then(() => sendResponse({ success: true }));
    return true;
  }

  // ── NEW: Content script asks for Customer ID by name ──────────────────────
  if (message.type === 'GET_CUSTOMER_ID') {
    chrome.storage.local.get('customerMap').then(({ customerMap }) => {
      if (!customerMap || !message.customerName) {
        sendResponse({ customerId: null });
        return;
      }
      // Case-insensitive lookup
      const name = message.customerName.trim().toLowerCase();
      const entry = Object.entries(customerMap).find(
        ([k]) => k.toLowerCase() === name
      );
      sendResponse({ customerId: entry ? entry[1] : null });
    });
    return true;
  }

});
