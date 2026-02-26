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

// Export elements
const exportBtn = document.getElementById('exportBtn');
const exportFeedback = document.getElementById('exportFeedback');

// Search elements
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');

// ID mode elements
const idModeQb = document.getElementById('idModeQb');
const idModeCustom = document.getElementById('idModeCustom');
const idModeCustomInput = document.getElementById('idModeCustomInput');
const customStartInput = document.getElementById('customStartInput');
const saveIdModeBtn = document.getElementById('saveIdModeBtn');
const idModeHint = document.getElementById('idModeHint');

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

// ─── Search by Customer ID (live) ────────────────────────────────────────────
let customerMapCache = null;
let realmIdCache = null;

async function getSearchData() {
  if (!customerMapCache) {
    const data = await chrome.storage.local.get(['customerMap', 'qbRealmId']);
    customerMapCache = data.customerMap || {};
    realmIdCache = data.qbRealmId || '';
  }
  return { customerMap: customerMapCache, realmId: realmIdCache };
}

function buildQbLink(customerId, realmId) {
  if (!realmId) return null;
  return `https://app.qbo.intuit.com/app/customerdetail?nameId=${customerId}&companyId=${realmId}`;
}

searchInput.addEventListener('input', async () => {
  const query = searchInput.value.trim().toLowerCase();

  if (!query) {
    searchResults.innerHTML = '';
    return;
  }

  const { customerMap, realmId } = await getSearchData();

  // Build ID→name map and filter matches
  const matches = [];
  for (const [name, id] of Object.entries(customerMap)) {
    const idStr = String(id);
    if (idStr.startsWith(query) || name.toLowerCase().includes(query)) {
      matches.push({ id: idStr, name });
    }
  }

  // Sort: ID matches first (numerically), then name matches
  matches.sort((a, b) => {
    const aIdMatch = a.id.startsWith(query);
    const bIdMatch = b.id.startsWith(query);
    if (aIdMatch && !bIdMatch) return -1;
    if (!aIdMatch && bIdMatch) return 1;
    return parseInt(a.id) - parseInt(b.id);
  });

  const top10 = matches.slice(0, 10);

  if (top10.length === 0) {
    searchResults.innerHTML = `<div class="search-empty">No customers match "${searchInput.value.trim()}"</div>`;
    return;
  }

  searchResults.innerHTML = top10.map(({ id, name }) => {
    const url = buildQbLink(id, realmId);
    const nameHtml = url
      ? `<a href="#" class="search-name link" data-url="${url}">${name}</a>`
      : `<span class="search-name">${name}</span>`;
    return `
      <div class="search-row">
        <span class="search-id">#${id}</span>
        ${nameHtml}
      </div>`;
  }).join('');

  if (matches.length > 10) {
    searchResults.innerHTML += `<div class="search-more">+${matches.length - 10} more — type more to narrow down</div>`;
  }

  // Navigate existing QB tab instead of opening a new one
  searchResults.querySelectorAll('a[data-url]').forEach(link => {
    link.addEventListener('click', async (e) => {
      e.preventDefault();
      const url = link.dataset.url;
      const tabs = await chrome.tabs.query({ url: ['https://app.qbo.intuit.com/*', 'https://qbo.intuit.com/*', 'https://sandbox.qbo.intuit.com/*'] });
      if (tabs.length > 0) {
        await chrome.tabs.update(tabs[0].id, { url, active: true });
        await chrome.windows.update(tabs[0].windowId, { focused: true });
      } else {
        // No QB tab open — open a new one as fallback
        chrome.tabs.create({ url });
      }
      window.close();
    });
  });
});

// ─── Export CSV Button ────────────────────────────────────────────────────────
exportBtn.addEventListener('click', async () => {
  exportBtn.disabled = true;
  exportBtn.textContent = 'Fetching data...';
  exportFeedback.textContent = '';

  try {
    const { licenseKey } = await chrome.storage.local.get('licenseKey');
    const response = await fetch(`${SERVER_URL}/auth/qb/export/customers?licenseKey=${encodeURIComponent(licenseKey)}`);

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Export failed');
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const date = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    a.href = url;
    a.download = `customers-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    exportFeedback.className = 'export-feedback success';
    exportFeedback.textContent = '✅ Download started';
    setTimeout(() => { exportFeedback.textContent = ''; }, 3000);
  } catch (err) {
    exportFeedback.className = 'export-feedback error';
    exportFeedback.textContent = `❌ ${err.message}`;
  } finally {
    exportBtn.disabled = false;
    exportBtn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
      Export Customer List (CSV)`;
  }
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

// ─── ID Mode ──────────────────────────────────────────────────────────────────
async function loadIdMode() {
  const { idMode, customIdStart } = await chrome.storage.local.get(['idMode', 'customIdStart']);
  const mode = idMode || 'qb';

  if (mode === 'qb') {
    idModeQb.checked = true;
    idModeCustomInput.style.display = 'none';
    idModeHint.textContent = 'Showing QB internal IDs (e.g. 1, 2, 67)';
  } else {
    idModeCustom.checked = true;
    idModeCustomInput.style.display = 'flex';
    customStartInput.value = customIdStart || 1000;
    idModeHint.textContent = `Custom IDs active — starting from ${customIdStart || 1000}`;
  }
}

idModeQb.addEventListener('change', () => {
  idModeCustomInput.style.display = 'none';
  idModeHint.textContent = 'Showing QB internal IDs (e.g. 1, 2, 67)';
});

idModeCustom.addEventListener('change', () => {
  idModeCustomInput.style.display = 'flex';
  idModeHint.textContent = 'Enter a starting number and click Apply, then Sync.';
});

saveIdModeBtn.addEventListener('click', async () => {
  const start = parseInt(customStartInput.value);
  if (!start || start < 1) {
    idModeHint.textContent = 'Please enter a valid starting number.';
    return;
  }
  await chrome.storage.local.set({ idMode: 'custom', customIdStart: start });
  idModeHint.textContent = `✓ Saved — custom IDs will start from ${start} on next sync.`;
  setTimeout(() => {
    idModeHint.textContent = `Custom IDs active — starting from ${start}`;
  }, 3000);
});

// Load ID mode when QB is connected
document.addEventListener('DOMContentLoaded', () => {
  // Load ID mode after a short delay to ensure QB state is loaded
  setTimeout(loadIdMode, 100);
});

// ─── Migrate Existing IDs ─────────────────────────────────────────────────────
let migrateData = [];

document.getElementById('migrateToggleBtn').addEventListener('click', () => {
  const panel = document.getElementById('migratePanel');
  panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
});

document.getElementById('idModeToggleBtn').addEventListener('click', () => {
  const panel = document.getElementById('idModePanel');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
});

document.getElementById('migrateScanBtn').addEventListener('click', async () => {
  const scanBtn = document.getElementById('migrateScanBtn');
  const resultsEl = document.getElementById('migrateResults');
  const confirmBtn = document.getElementById('migrateConfirmBtn');
  const feedback = document.getElementById('migrateFeedback');

  scanBtn.disabled = true;
  scanBtn.textContent = 'Scanning...';
  resultsEl.innerHTML = '';
  confirmBtn.style.display = 'none';
  feedback.textContent = '';

  try {
    const { licenseKey } = await chrome.storage.local.get('licenseKey');
    const response = await fetch(`${SERVER_URL}/auth/qb/migrate-scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey }),
    });
    const data = await response.json();

    if (!response.ok || !data.success) {
      feedback.className = 'migrate-feedback error';
      feedback.textContent = data.error || 'Scan failed.';
      return;
    }

    migrateData = data.found;

    if (migrateData.length === 0) {
      resultsEl.innerHTML = '<div class="migrate-empty">No existing IDs detected in customer fields.</div>';
      return;
    }

    resultsEl.innerHTML = migrateData.map((item, i) => `
      <div class="migrate-row">
        <input type="checkbox" data-index="${i}" checked />
        <span class="migrate-id">${item.detectedId}</span>
        <span class="migrate-name" title="${item.name}">${item.name}</span>
        <span class="migrate-source">${item.sourceField}</span>
      </div>
    `).join('');

    confirmBtn.style.display = 'block';
    confirmBtn.textContent = `Confirm Migration (${migrateData.length} customers)`;

  } catch (err) {
    feedback.className = 'migrate-feedback error';
    feedback.textContent = 'Network error: ' + err.message;
  } finally {
    scanBtn.disabled = false;
    scanBtn.textContent = 'Scan Customers';
  }
});

document.getElementById('migrateConfirmBtn').addEventListener('click', async () => {
  const confirmBtn = document.getElementById('migrateConfirmBtn');
  const feedback = document.getElementById('migrateFeedback');
  const cleanSource = document.getElementById('migrateCleanSource').checked;

  // Build list of checked items
  const checkboxes = document.querySelectorAll('#migrateResults input[type="checkbox"]');
  const confirmed = [];
  checkboxes.forEach((cb) => {
    if (cb.checked) {
      const item = migrateData[parseInt(cb.dataset.index)];
      confirmed.push({ ...item, cleanSource });
    }
  });

  if (confirmed.length === 0) {
    feedback.className = 'migrate-feedback error';
    feedback.textContent = 'No customers selected.';
    return;
  }

  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Migrating...';
  feedback.textContent = '';

  try {
    const { licenseKey } = await chrome.storage.local.get('licenseKey');
    const response = await fetch(`${SERVER_URL}/auth/qb/migrate-confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey, confirmed }),
    });
    const data = await response.json();

    if (!response.ok || !data.success) {
      feedback.className = 'migrate-feedback error';
      feedback.textContent = data.error || 'Migration failed.';
      return;
    }

    feedback.className = 'migrate-feedback success';
    feedback.textContent = `✅ ${data.migrated} customers migrated${data.errors > 0 ? `, ${data.errors} errors` : ''}. Syncing in 4s...`;
    confirmBtn.style.display = 'none';
    document.getElementById('migrateResults').innerHTML = '';

    // Wait 4s for QB API to propagate migrated values before syncing
    setTimeout(() => {
      chrome.runtime.sendMessage({ type: 'TRIGGER_SYNC' });
    }, 4000);

  } catch (err) {
    feedback.className = 'migrate-feedback error';
    feedback.textContent = 'Network error: ' + err.message;
  } finally {
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Confirm Migration';
  }
});
