// popup/popup.js
// Controls the extension popup UI
// Handles: license activation, QB OAuth connection, sync triggering

const SERVER_URL = 'https://clientid-server-production.up.railway.app';

// ─── Elements ────────────────────────────────────────────────────────────────
const statusBanner = document.getElementById('statusBanner');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const licenseSection = document.getElementById('licenseSection');
const licenseKeyInput = document.getElementById('licenseKeyInput');
const saveBtn = document.getElementById('saveBtn');
const saveFeedback = document.getElementById('saveFeedback');
const activeSection = document.getElementById('activeSection');
const periodEnd = document.getElementById('periodEnd');
const changeKeyBtn = document.getElementById('changeKeyBtn');
const noSubSection = document.getElementById('noSubSection');
const dashboardLink = document.getElementById('dashboardLink');
const footerVersion = document.getElementById('footerVersion');

// QB elements
const qbNotConnected = document.getElementById('qbNotConnected');
const qbConnected = document.getElementById('qbConnected');
const connectQbBtn = document.getElementById('connectQbBtn');
const qbFeedback = document.getElementById('qbFeedback');
const syncBtn = document.getElementById('syncBtn');
const syncStatus = document.getElementById('syncStatus');
const disconnectBtn = document.getElementById('disconnectBtn');

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const manifest = chrome.runtime.getManifest();
  footerVersion.textContent = `v${manifest.version}`;
  dashboardLink.href = SERVER_URL;

  setStatus('checking');
  await loadCurrentState();
});

// ─── Load Current State ───────────────────────────────────────────────────────
async function loadCurrentState() {
  const data = await chrome.storage.local.get([
    'licenseKey', 'licenseStatus',
    'qbConnected', 'qbConnectedAt',
    'syncStatus', 'syncCompletedAt', 'syncError', 'syncResult',
  ]);

  const { licenseKey, licenseStatus } = data;

  if (licenseKey) {
    licenseKeyInput.value = licenseKey;
  }

  if (!licenseKey) {
    setStatus('inactive', 'No license key entered');
    showSection('license');
    return;
  }

  if (!licenseStatus) {
    setStatus('checking', 'Checking license...');
    const response = await chrome.runtime.sendMessage({ type: 'CHECK_LICENSE' });
    renderStatus(response.licenseStatus, licenseKey, data);
    return;
  }

  renderStatus(licenseStatus, licenseKey, data);
}

function renderStatus(licenseStatus, licenseKey, fullData) {
  if (licenseStatus?.valid) {
    setStatus('active', 'Active — extension is running');
    showSection('active');

    if (licenseStatus.currentPeriodEnd) {
      const date = new Date(licenseStatus.currentPeriodEnd);
      periodEnd.textContent = `Renews ${date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;
    }

    // Render QB connection state
    renderQbState(fullData || {});
  } else {
    const reason = licenseStatus?.reason || 'Invalid license';
    if (reason.includes('Subscription is canceled') || reason.includes('No subscription')) {
      setStatus('inactive', 'Subscription inactive');
      showSection('nosub');
    } else {
      setStatus('inactive', reason);
      showSection('license');
    }
  }
}

// ─── QB Connection State ──────────────────────────────────────────────────────
function renderQbState(data) {
  if (data.qbConnected) {
    qbNotConnected.style.display = 'none';
    qbConnected.style.display = 'block';
    renderSyncStatus(data);
  } else {
    qbNotConnected.style.display = 'block';
    qbConnected.style.display = 'none';
  }
}

function renderSyncStatus(data) {
  const { syncStatus: status, syncCompletedAt, syncError, syncResult } = data;

  if (!status) {
    syncStatus.innerHTML = '<span class="sync-idle">No sync run yet. Click Sync Now to populate Client IDs.</span>';
    return;
  }

  if (status === 'syncing') {
    syncStatus.innerHTML = '<span class="sync-running"><span class="spinner"></span> Syncing customer IDs...</span>';
    syncBtn.disabled = true;
    syncBtn.textContent = 'Syncing...';
    // Poll for completion
    pollSyncStatus();
    return;
  }

  syncBtn.disabled = false;
  syncBtn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="23 4 23 10 17 10"></polyline>
      <polyline points="1 20 1 14 7 14"></polyline>
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
    </svg>
    Sync Now
  `;

  if (status === 'success') {
    const time = syncCompletedAt ? formatTimeAgo(syncCompletedAt) : '';
    const count = syncResult?.customersUpdated || syncResult?.count || '';
    const detail = count ? ` — ${count} customers updated` : '';
    syncStatus.innerHTML = `<span class="sync-success">✅ Sync complete${detail}</span>`;
    if (time) {
      syncStatus.innerHTML += `<span class="sync-time">${time}</span>`;
    }
  } else if (status === 'error') {
    syncStatus.innerHTML = `<span class="sync-error">❌ ${syncError || 'Sync failed'}</span>`;
  }
}

async function pollSyncStatus() {
  // Poll every 2 seconds to see if sync finished
  const poll = setInterval(async () => {
    const data = await chrome.storage.local.get(['syncStatus', 'syncCompletedAt', 'syncError', 'syncResult']);
    if (data.syncStatus !== 'syncing') {
      clearInterval(poll);
      renderSyncStatus(data);
    }
  }, 2000);
}

// ─── Connect QuickBooks Button ────────────────────────────────────────────────
connectQbBtn.addEventListener('click', async () => {
  connectQbBtn.disabled = true;
  connectQbBtn.textContent = 'Opening QuickBooks...';
  qbFeedback.textContent = '';

  const response = await chrome.runtime.sendMessage({ type: 'CONNECT_QB' });

  if (response?.success) {
    qbFeedback.className = 'qb-feedback success';
    qbFeedback.textContent = 'QuickBooks authorization opened. Complete it in the new tab.';
    connectQbBtn.textContent = 'Waiting for authorization...';

    // Poll for QB connection to complete
    const poll = setInterval(async () => {
      const data = await chrome.storage.local.get(['qbConnected']);
      if (data.qbConnected) {
        clearInterval(poll);
        connectQbBtn.disabled = false;
        connectQbBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
          </svg>
          Connect QuickBooks
        `;
        qbFeedback.textContent = '';
        // Reload entire state to show connected view
        await loadCurrentState();
      }
    }, 1500);
  } else {
    qbFeedback.className = 'qb-feedback error';
    qbFeedback.textContent = response?.error || 'Failed to start QuickBooks connection.';
    connectQbBtn.disabled = false;
    connectQbBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
      </svg>
      Connect QuickBooks
    `;
  }
});

// ─── Sync Button ──────────────────────────────────────────────────────────────
syncBtn.addEventListener('click', async () => {
  syncBtn.disabled = true;
  syncBtn.textContent = 'Syncing...';
  syncStatus.innerHTML = '<span class="sync-running"><span class="spinner"></span> Syncing customer IDs...</span>';

  const response = await chrome.runtime.sendMessage({ type: 'TRIGGER_SYNC' });

  // Refresh sync status from storage (service worker updates it)
  const data = await chrome.storage.local.get(['syncStatus', 'syncCompletedAt', 'syncError', 'syncResult']);
  renderSyncStatus(data);
});

// ─── Disconnect Button ───────────────────────────────────────────────────────
disconnectBtn.addEventListener('click', async () => {
  if (!confirm('Disconnect QuickBooks? You can reconnect anytime.')) return;

  await chrome.runtime.sendMessage({ type: 'DISCONNECT_QB' });
  await loadCurrentState();
});

// ─── Save License Key ─────────────────────────────────────────────────────────
saveBtn.addEventListener('click', async () => {
  const key = licenseKeyInput.value.trim();

  if (!key) {
    showFeedback('Please enter your license key.', 'error');
    return;
  }

  if (!key.startsWith('CIQB-')) {
    showFeedback('Invalid format. Key should start with CIQB-', 'error');
    return;
  }

  saveBtn.textContent = 'Checking...';
  saveBtn.disabled = true;

  await chrome.storage.local.set({ licenseKey: key });

  const response = await chrome.runtime.sendMessage({ type: 'LICENSE_KEY_SAVED' });

  saveBtn.textContent = 'Save';
  saveBtn.disabled = false;

  if (response?.licenseStatus?.valid) {
    showFeedback('License activated! ✓', 'success');
    setTimeout(() => {
      loadCurrentState();
    }, 800);
  } else {
    const reason = response?.licenseStatus?.reason || 'Invalid license key.';
    showFeedback(reason, 'error');
  }
});

// ─── Change Key Button ────────────────────────────────────────────────────────
changeKeyBtn.addEventListener('click', () => {
  showSection('license');
  setStatus('inactive', 'Enter new license key');
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function setStatus(state, message) {
  statusDot.className = `status-dot ${state}`;
  statusText.textContent = message || state;
}

function showSection(section) {
  licenseSection.style.display = 'none';
  activeSection.style.display = 'none';
  noSubSection.style.display = 'none';

  if (section === 'license') licenseSection.style.display = 'block';
  if (section === 'active') activeSection.style.display = 'block';
  if (section === 'nosub') noSubSection.style.display = 'block';
}

function showFeedback(message, type) {
  saveFeedback.textContent = message;
  saveFeedback.className = `save-feedback ${type}`;
  setTimeout(() => {
    saveFeedback.textContent = '';
    saveFeedback.className = 'save-feedback';
  }, 4000);
}

function formatTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
