// background/service-worker.js
// Runs in the background. Responsible for:
// 1. Validating the license key against your server on startup + periodically
// 2. Caching license status so content script can check it instantly
// 3. Setting up alarms for periodic re-validation (every 24 hours)
// 4. Handling QB OAuth flow — detecting callback success page
// 5. Triggering sync after QB connection

const SERVER_URL = 'https://clientid-server-production.up.railway.app';
const VALIDATE_INTERVAL_MINUTES = 60 * 24; // 24 hours

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

// ─── Alarm for periodic re-validation ───────────────────────────────────────
function setupAlarm() {
  chrome.alarms.clearAll(() => {
    chrome.alarms.create('licenseCheck', {
      periodInMinutes: VALIDATE_INTERVAL_MINUTES,
    });
  });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'licenseCheck') {
    await validateLicense();
  }
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
    console.log('[ClientID] License check result:', data);
  } catch (err) {
    console.warn('[ClientID] License check failed (network error):', err.message);
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
// We watch for the server's OAuth success page tab to detect when the user
// has completed the QuickBooks authorization flow.

let oauthTabHandled = false;

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url) return;
  if (oauthTabHandled) return;

  // Only match the EXACT success page path
  let pathname;
  try {
    const tabUrl = new URL(tab.url);
    // Must be our server domain
    const serverUrl = new URL(SERVER_URL);
    if (tabUrl.hostname !== serverUrl.hostname) return;
    pathname = tabUrl.pathname;
  } catch (e) {
    return;
  }

  if (pathname !== '/auth/qb/success') return;

  // Prevent handling this multiple times
  oauthTabHandled = true;

  console.log('[ClientID] QB OAuth success detected.');

  // Store QB connected status
  await chrome.storage.local.set({
    qbConnected: true,
    qbConnectedAt: Date.now(),
  });

  // Close the success tab after a longer delay so user can see it
  setTimeout(() => {
    chrome.tabs.remove(tabId).catch(() => {});
    oauthTabHandled = false;
  }, 3000);

  // Trigger sync automatically
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
      await chrome.storage.local.set({
        syncStatus: 'success',
        syncCompletedAt: Date.now(),
        syncResult: data,
      });
      console.log('[ClientID] Sync completed:', data);
      return { success: true, data };
    } else {
      const error = data.error || data.message || 'Sync failed.';
      await chrome.storage.local.set({
        syncStatus: 'error',
        syncError: error,
      });
      console.error('[ClientID] Sync failed:', error);
      return { success: false, error };
    }
  } catch (err) {
    const error = `Network error: ${err.message}`;
    await chrome.storage.local.set({
      syncStatus: 'error',
      syncError: error,
    });
    console.error('[ClientID] Sync error:', err);
    return { success: false, error };
  }
}

// ─── Message Handler ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // Content script asks: am I allowed to run?
  if (message.type === 'CHECK_LICENSE') {
    chrome.storage.local.get(['licenseStatus', 'licenseCheckedAt']).then(({ licenseStatus }) => {
      sendResponse({ licenseStatus: licenseStatus || { valid: false, reason: 'Not checked yet.' } });
    });
    return true;
  }

  // Popup saved a new license key — re-validate immediately
  if (message.type === 'LICENSE_KEY_SAVED') {
    validateLicense().then(() => {
      chrome.storage.local.get('licenseStatus').then(({ licenseStatus }) => {
        sendResponse({ licenseStatus });
      });
    });
    return true;
  }

  // Popup requests current status (license + QB + sync)
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

  // Popup requests QB OAuth URL
  if (message.type === 'CONNECT_QB') {
    (async () => {
      try {
        const { licenseKey } = await chrome.storage.local.get('licenseKey');
        const response = await fetch(`${SERVER_URL}/auth/qb/connect-url?licenseKey=${encodeURIComponent(licenseKey)}`);
        const data = await response.json();

        if (data.url) {
          // Open OAuth URL in a new tab
          chrome.tabs.create({ url: data.url });
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: data.error || 'Could not get connect URL.' });
        }
      } catch (err) {
        sendResponse({ success: false, error: `Network error: ${err.message}` });
      }
    })();
    return true;
  }

  // Popup requests manual sync
  if (message.type === 'TRIGGER_SYNC') {
    triggerSync().then((result) => {
      sendResponse(result);
    });
    return true;
  }

  // Popup requests disconnect
  if (message.type === 'DISCONNECT_QB') {
    chrome.storage.local.set({
      qbConnected: false,
      qbConnectedAt: null,
      syncStatus: null,
      syncCompletedAt: null,
      syncError: null,
      syncResult: null,
    }).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }
});
