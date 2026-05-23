let activityChart;
let allAccounts = [];
let allDevices = [];
let allTransactions = [];

const log = (message) => {
  const el = document.getElementById('log');
  if (!el) return;
  const ts = new Date().toLocaleTimeString();
  const line = `[${ts}] ${message}`;
  const MAX_LINES = 200;
  const existing = el.textContent ? el.textContent.split('\n').filter(Boolean) : [];
  existing.unshift(line);
  if (existing.length > MAX_LINES) existing.length = MAX_LINES;
  el.textContent = existing.join('\n') + '\n';
};

const showAlert = (message, type = 'info') => {
  const alertArea = document.getElementById('actionAlert');
  alertArea.innerHTML = `<div class="alert alert-${type} alert-dismissible fade show mb-0" role="alert">
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    </div>`;
};

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Request failed: ${response.status} ${response.statusText} ${text}`);
  }
  return await response.json();
};

const fetchData = async () => {
  try {
    const [mResp, accResp, txResp] = await Promise.all([
      fetch('/api/mesh/state'),
      fetch('/api/accounts'),
      fetch('/api/transactions')
    ]);
    const meshState = await mResp.json();
    allAccounts = await accResp.json();
    allDevices = meshState.devices || [];
    allTransactions = await txResp.json();

    renderAccounts();
    renderDevices(allDevices);
    renderTransactions();
    updateCacheInfo(meshState.idempotencyCacheSize);
    updateSummaryCards();
    updateChart();
    updateLastRefreshed();
  } catch (e) {
    console.error('refresh failed', e);
    log(`Refresh failed: ${e.message}`);
    showAlert(`Refresh failed: ${e.message}`, 'danger');
  }
};

const renderAccounts = () => {
  const senderSelect = document.getElementById('senderVpa');
  const receiverSelect = document.getElementById('receiverVpa');
  const accountsBody = document.querySelector('#accounts-table tbody');

  // preserve current selections so frequent refreshes don't clear user choices
  const prevSender = senderSelect ? senderSelect.value : '';
  const prevReceiver = receiverSelect ? receiverSelect.value : '';

  senderSelect.innerHTML = '<option value="" disabled>Select sender</option>';
  receiverSelect.innerHTML = '<option value="" disabled>Select receiver</option>';
  accountsBody.innerHTML = '';

  allAccounts.forEach(account => {
    const label = `${account.holderName} (${account.vpa})`;
    senderSelect.insertAdjacentHTML('beforeend', `<option value="${account.vpa}">${label}</option>`);
    receiverSelect.insertAdjacentHTML('beforeend', `<option value="${account.vpa}">${label}</option>`);
    accountsBody.insertAdjacentHTML('beforeend', `<tr><td>${account.vpa}</td><td>${account.holderName}</td><td class="text-success">₹${parseFloat(account.balance).toFixed(2)}</td></tr>`);
  });

  // restore previous selections if still present
  if (prevSender) {
    const opt = Array.from(senderSelect.options).find(o => o.value === prevSender);
    if (opt) senderSelect.value = prevSender;
  }
  if (prevReceiver) {
    const opt = Array.from(receiverSelect.options).find(o => o.value === prevReceiver);
    if (opt) receiverSelect.value = prevReceiver;
  }

  updateReceiverOptions();
};

const updateReceiverOptions = () => {
  const senderVpa = document.getElementById('senderVpa').value;
  const receiverSelect = document.getElementById('receiverVpa');
  Array.from(receiverSelect.options).forEach(option => {
    if (!option.value) return;
    option.disabled = senderVpa && option.value === senderVpa;
  });
  if (senderVpa && receiverSelect.value === senderVpa) {
    receiverSelect.value = '';
  }
};

const renderDevices = (devices) => {
  const devicesArea = document.getElementById('devices');
  devicesArea.innerHTML = '';

  if (!devices || devices.length === 0) {
    devicesArea.innerHTML = '<div class="text-muted small">No connected mesh devices.</div>';
    return;
  }

  devices.forEach(device => {
    const wrapper = document.createElement('div');
    wrapper.className = 'device-card p-3 mb-2 rounded bg-white shadow-sm';
    const packetsHtml = (device.packetIds || []).map(id => {
      const short = String(id).substring(0, 8);
      return `<span class="packet-id me-1">${short}</span>`;
    }).join('');
    wrapper.innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-2">
        <div><strong>${device.deviceId}</strong></div>
        <span class="badge ${device.hasInternet ? 'bg-success' : 'bg-secondary'}">
          ${device.hasInternet ? 'ONLINE' : 'OFFLINE'}
        </span>
      </div>
      <div class="small text-muted">Holding ${device.packetCount} packet(s)</div>
      ${packetsHtml ? `<div class="mt-2">${packetsHtml}</div>` : ''}
    `;
    devicesArea.appendChild(wrapper);
  });
};

const renderTransactions = () => {
  const txBody = document.querySelector('#tx-table tbody');
  const filteredTransactions = getFilteredTransactions();
  const visibleTxs = filteredTransactions.slice().reverse();

  if (visibleTxs.length === 0) {
    txBody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">No transactions match the current filter.</td></tr>';
    return;
  }

  txBody.innerHTML = visibleTxs.map(tx => `
      <tr>
        <td>${tx.id}</td>
        <td>${tx.senderVpa}</td>
        <td>${tx.receiverVpa}</td>
        <td>₹${parseFloat(tx.amount).toFixed(2)}</td>
        <td><span class="badge ${getStatusClass(tx.status)}">${tx.status}</span></td>
        <td>${tx.bridgeNodeId || '–'}</td>
        <td>${tx.hopCount || 0}</td>
        <td class="small">${tx.settledAt ? new Date(tx.settledAt).toLocaleTimeString() : '–'}</td>
      </tr>`).join('');
};

const getStatusClass = (status) => {
  switch (status) {
    case 'SETTLED': return 'bg-success';
    case 'REJECTED': return 'bg-secondary';
    case 'DUPLICATE_DROPPED': return 'bg-warning text-dark';
    case 'INVALID': return 'bg-danger';
    default: return 'bg-info text-dark';
  }
};

const getFilteredTransactions = () => {
  const statusFilter = document.getElementById('filterStatus')?.value || 'ALL';
  const searchText = document.getElementById('searchTransactions')?.value.trim().toLowerCase() || '';

  return allTransactions.filter(tx => {
    const matchesStatus = statusFilter === 'ALL' || tx.status === statusFilter;
    if (!matchesStatus) return false;

    if (!searchText) return true;

    return [tx.senderVpa, tx.receiverVpa, tx.bridgeNodeId, tx.id]
      .filter(Boolean)
      .some(field => field.toString().toLowerCase().includes(searchText));
  });
};

const updateCacheInfo = (cacheSize) => {
  document.getElementById('cacheInfo').textContent = `Idempotency cache size: ${cacheSize || 0}`;
};

const updateSummaryCards = () => {
  document.getElementById('summaryAccounts').textContent = allAccounts.length;
  document.getElementById('summaryDevices').textContent = allDevices.length;
  const settledTotal = allTransactions
    .filter(tx => tx.status === 'SETTLED')
    .reduce((sum, tx) => sum + Number(tx.amount), 0);
  document.getElementById('summarySettled').textContent = `₹${settledTotal.toFixed(2)}`;
};

const updateLastRefreshed = () => {
  document.getElementById('summaryRefreshed').textContent = new Date().toLocaleTimeString();
};

const updateChart = () => {
  const counts = { SETTLED: 0, REJECTED: 0, DUPLICATE_DROPPED: 0, INVALID: 0 };
  allTransactions.forEach(tx => {
    if (counts.hasOwnProperty(tx.status)) {
      counts[tx.status]++;
    }
  });

  const labels = ['Settled', 'Rejected', 'Duplicates', 'Invalid'];
  const data = [counts.SETTLED, counts.REJECTED, counts.DUPLICATE_DROPPED, counts.INVALID];

  const ctx = document.getElementById('activityChart').getContext('2d');
  if (!activityChart) {
    activityChart = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Transaction counts', data, backgroundColor: ['#198754', '#6c757d', '#ffc107', '#dc3545'] }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
  } else {
    activityChart.data.labels = labels;
    activityChart.data.datasets[0].data = data;
    activityChart.update();
  }
};

const sendPacket = async () => {
  const sender = document.getElementById('senderVpa').value;
  const receiver = document.getElementById('receiverVpa').value;
  const amount = parseFloat(document.getElementById('amount').value);
  const pin = document.getElementById('pin').value.trim();

  if (!sender || !receiver || sender === receiver) {
    showAlert('Select a distinct sender and receiver account.', 'warning');
    return;
  }
  if (!amount || amount <= 0) {
    showAlert('Enter a valid amount greater than zero.', 'warning');
    return;
  }
  if (!/^[0-9]{4}$/.test(pin)) {
    showAlert('Enter a valid 4-digit PIN.', 'warning');
    return;
  }

  try {
    const body = {
      senderVpa: sender,
      receiverVpa: receiver,
      amount,
      pin,
      ttl: 5,
      startDevice: 'phone-alice'
    };
    const res = await fetch('/api/demo/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = await res.json();
    const msg = `Packet injected: ${result.packetId ? result.packetId.substring(0, 8) : 'unknown'} from ${sender} to ${receiver}`;
    log(msg);
    showAlert(msg, 'success');
    await fetchData();
  } catch (e) {
    log(`Send failed: ${e.message}`);
    showAlert(`Send failed: ${e.message}`, 'danger');
  }
};

const gossip = async () => {
  try {
    const res = await fetch('/api/mesh/gossip', { method: 'POST' });
    const result = await res.json();
    const msg = `Gossip completed (${result.transfers || 0} transfers)`;
    log(msg);
    showAlert(msg, 'success');
    await fetchData();
  } catch (e) {
    log(`Gossip failed: ${e.message}`);
    showAlert(`Gossip failed: ${e.message}`, 'danger');
  }
};

const flushBridges = async () => {
  try {
    const res = await fetch('/api/mesh/flush', { method: 'POST' });
    const result = await res.json();
    const msg = `Bridge upload: ${result.uploadsAttempted || 0} uploads attempted`;
    log(msg);
    showAlert(msg, 'success');
    await fetchData();
  } catch (e) {
    log(`Flush failed: ${e.message}`);
    showAlert(`Flush failed: ${e.message}`, 'danger');
  }
};

const resetMesh = async () => {
  try {
    await fetch('/api/mesh/reset', { method: 'POST' });
    const msg = 'Mesh and idempotency cache reset successfully.';
    log(msg);
    showAlert(msg, 'success');
    await fetchData();
  } catch (e) {
    log(`Reset failed: ${e.message}`);
    showAlert(`Reset failed: ${e.message}`, 'danger');
  }
};

const filterTransactions = () => {
  renderTransactions();
};

const init = async () => {
  await fetchData();
  document.getElementById('senderVpa').addEventListener('change', updateReceiverOptions);
  document.getElementById('filterStatus').addEventListener('change', filterTransactions);
  document.getElementById('searchTransactions').addEventListener('input', filterTransactions);
  setInterval(fetchData, 3000);
};

init();
