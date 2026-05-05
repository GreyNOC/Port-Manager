const api = window.greynoc;

const state = {
  ports: [],
  timers: [],
  seenKeys: new Set(),
  notifications: false
};

const $ = (id) => document.getElementById(id);

const elements = {
  activeCount: $('activeCount'),
  newCount: $('newCount'),
  timerCount: $('timerCount'),
  lastScan: $('lastScan'),
  portsBody: $('portsBody'),
  timersList: $('timersList'),
  scanStatus: $('scanStatus'),
  filterInput: $('filterInput'),
  scopeFilter: $('scopeFilter'),
  timerPreset: $('timerPreset'),
  customTimerWrap: $('customTimerWrap'),
  customTimer: $('customTimer'),
  refreshBtn: $('refreshBtn'),
  notifyBtn: $('notifyBtn'),
  clearLogBtn: $('clearLogBtn'),
  activityLog: $('activityLog'),
  rowTemplate: $('portRowTemplate')
};

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds || 0));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function formatClock(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

function setText(node, value) {
  node.textContent = value == null ? '' : String(value);
}

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function badge(text, variant) {
  const span = document.createElement('span');
  span.className = `badge ${variant}`;
  span.textContent = text;
  return span;
}

function getTimerSeconds() {
  const preset = elements.timerPreset.value;
  if (preset === 'custom') return Number(elements.customTimer.value || 0);
  return Number(preset);
}

function log(message, type = 'info') {
  const item = document.createElement('div');
  item.className = `log-item ${type}`;
  const stamp = document.createElement('strong');
  stamp.textContent = formatClock(new Date().toISOString());
  item.appendChild(stamp);
  item.appendChild(document.createTextNode(' ' + String(message || '')));
  elements.activityLog.prepend(item);
  while (elements.activityLog.children.length > 40) {
    elements.activityLog.removeChild(elements.activityLog.lastElementChild);
  }
}

function notify(title, body) {
  if (!state.notifications || !('Notification' in window) || Notification.permission !== 'granted') return;
  try { new Notification(title, { body }); } catch (_) {}
}

function filteredPorts() {
  const query = elements.filterInput.value.trim().toLowerCase();
  const scope = elements.scopeFilter.value;
  return state.ports.filter((server) => {
    if (scope !== 'all' && server.scope !== scope) return false;
    if (!query) return true;
    const haystack = [
      server.port,
      server.pid,
      server.processName,
      server.commandLine,
      server.label,
      (server.addresses || []).join(' '),
      server.scope
    ].join(' ').toLowerCase();
    return haystack.includes(query);
  });
}

function renderStats(summary, scannedAt) {
  setText(elements.activeCount, summary.active || 0);
  setText(elements.newCount, summary.newCount || 0);
  setText(elements.timerCount, summary.timers || 0);
  setText(elements.lastScan, formatClock(scannedAt));
}

function renderPorts() {
  const rows = filteredPorts();
  clearChildren(elements.portsBody);

  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 8;
    td.className = 'empty';
    td.textContent = 'No matching local servers found.';
    tr.appendChild(td);
    elements.portsBody.appendChild(tr);
    return;
  }

  for (const server of rows) {
    const row = elements.rowTemplate.content.firstElementChild.cloneNode(true);
    const isLocalhost = server.scope === 'localhost';
    const timer = server.timer;
    const addresses = (server.addresses || []).join(', ');

    const statusCell = row.querySelector('.status-cell');
    if (server.isNew) statusCell.appendChild(badge('New', 'new'));
    statusCell.appendChild(badge(isLocalhost ? 'localhost' : 'local server', isLocalhost ? 'localhost' : 'network'));
    if (server.protected) statusCell.appendChild(badge('protected', 'warning'));
    if (server.ownedByCurrentUser === false) statusCell.appendChild(badge('not your process', 'warning'));

    const portCell = row.querySelector('.port-cell');
    const portName = document.createElement('span');
    portName.className = 'mono';
    portName.textContent = `:${server.port}`;
    const labelLine = document.createElement('div');
    labelLine.className = 'muted';
    labelLine.textContent = server.label || '';
    portCell.append(portName, labelLine);

    const processCell = row.querySelector('.process-cell');
    const procLine = document.createElement('div');
    procLine.textContent = server.processName || '';
    const cmdLine = document.createElement('div');
    cmdLine.className = 'command';
    cmdLine.title = server.commandLine || '';
    cmdLine.textContent = server.commandLine || '';
    processCell.append(procLine, cmdLine);

    const pidCell = row.querySelector('.pid-cell');
    const pidSpan = document.createElement('span');
    pidSpan.className = 'mono';
    pidSpan.textContent = String(server.pid);
    pidCell.appendChild(pidSpan);

    setText(row.querySelector('.alive-cell'), formatDuration(server.aliveSeconds));

    const addressCell = row.querySelector('.address-cell');
    const addrSpan = document.createElement('span');
    addrSpan.className = 'mono';
    addrSpan.textContent = addresses;
    addressCell.appendChild(addrSpan);

    const timerCell = row.querySelector('.timer-cell');
    if (timer) {
      const remaining = Math.max(0, (Date.parse(timer.dueAt) - Date.now()) / 1000);
      timerCell.appendChild(badge(`${formatDuration(remaining)} left`, 'timer'));
    } else {
      const none = document.createElement('span');
      none.className = 'timer-mini';
      none.textContent = 'No timer';
      timerCell.appendChild(none);
    }

    const actions = row.querySelector('.actions-cell');
    const stopButton = document.createElement('button');
    stopButton.className = 'button small danger';
    stopButton.textContent = 'Stop selected';
    stopButton.disabled = !server.stopAllowed;
    stopButton.addEventListener('click', () => stopServer(server));

    const timerButton = document.createElement('button');
    timerButton.className = 'button small secondary';
    timerButton.textContent = 'Set timer';
    timerButton.disabled = !server.stopAllowed;
    timerButton.addEventListener('click', () => setTimer(server));

    const wrap = document.createElement('div');
    wrap.className = 'action-stack';
    wrap.append(timerButton, stopButton);
    actions.appendChild(wrap);
    elements.portsBody.appendChild(row);
  }
}

function renderTimers() {
  const timers = state.timers;
  clearChildren(elements.timersList);
  if (!timers.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-card';
    empty.textContent = 'No timers set.';
    elements.timersList.appendChild(empty);
    return;
  }

  for (const timer of timers) {
    const card = document.createElement('article');
    card.className = 'timer-card';
    const remainingSeconds = Math.max(0, Math.floor((Date.parse(timer.dueAt) - Date.now()) / 1000));
    const isPending = timer.status === 'pending';

    const head = document.createElement('strong');
    head.textContent = `:${timer.port} ${timer.label || timer.processName}`;
    const meta = document.createElement('div');
    meta.className = 'timer-meta';
    const m1 = document.createElement('span');
    m1.textContent = `PID ${timer.pid} · ${timer.processName}`;
    const m2 = document.createElement('span');
    m2.textContent = `Status: ${timer.status}`;
    const m3 = document.createElement('span');
    m3.textContent = isPending ? `${formatDuration(remainingSeconds)} remaining` : (timer.result || 'Done');
    meta.append(m1, m2, m3);
    card.append(head, meta);

    if (isPending) {
      const cancel = document.createElement('button');
      cancel.className = 'button small ghost';
      cancel.textContent = 'Cancel timer';
      cancel.addEventListener('click', () => cancelTimer(timer.id));
      card.appendChild(cancel);
    }
    elements.timersList.appendChild(card);
  }
}

async function loadPorts(silent = false) {
  try {
    elements.scanStatus.textContent = 'Scanning local ports...';
    const data = await api.listPorts();
    const previousKeys = new Set(state.ports.map((server) => server.key));
    state.ports = data.servers || [];

    for (const server of state.ports) {
      if (!previousKeys.has(server.key) && !state.seenKeys.has(server.key)) {
        state.seenKeys.add(server.key);
        log(`New local server detected on :${server.port} (${server.processName}, PID ${server.pid}).`, 'success');
        notify('New local server detected', `:${server.port} ${server.processName}`);
      }
    }

    renderStats(data.summary || {}, data.scannedAt);
    renderPorts();
    await loadTimers(true);
    elements.scanStatus.textContent = `Watching ${state.ports.length} local server${state.ports.length === 1 ? '' : 's'} every 3 seconds.`;
    if (data.errors && data.errors.length && !silent) {
      log(`Scanner warnings: ${data.errors.join(' | ')}`, 'error');
    }
  } catch (error) {
    elements.scanStatus.textContent = 'Scan failed.';
    log(error.message || String(error), 'error');
  }
}

async function loadTimers(silent = false) {
  try {
    const data = await api.listTimers();
    state.timers = (data.timers || []).slice(0, 12);
    renderTimers();
  } catch (error) {
    if (!silent) log(error.message || String(error), 'error');
  }
}

async function setTimer(server) {
  const seconds = getTimerSeconds();
  if (!Number.isFinite(seconds) || seconds < 5) {
    log('Pick a timer of at least 5 seconds.', 'error');
    return;
  }
  const label = `:${server.port} (${server.processName}, PID ${server.pid})`;
  const confirmed = await api.confirm({
    title: 'Set auto-close timer',
    message: `Set an auto-close timer for ${label}?`,
    detail: `It will close in ${formatDuration(seconds)}.`
  });
  if (!confirmed) return;

  const result = await api.createTimer({
    key: server.key,
    pid: server.pid,
    port: server.port,
    commandLine: server.commandLine,
    seconds
  });
  if (!result.ok) {
    log(result.error || 'Could not set timer.', 'error');
    return;
  }
  log(`Timer set for ${label} in ${formatDuration(result.timer.seconds)}.`, 'success');
  await loadPorts(true);
}

async function stopServer(server) {
  const confirmed = await api.confirm({
    title: 'Stop selected local server',
    message: `Stop the local server on :${server.port}?`,
    detail: `Process: ${server.processName}\nPID: ${server.pid}\n\nOnly continue if you recognize this dev server.`
  });
  if (!confirmed) return;

  const result = await api.stopServer({
    key: server.key,
    pid: server.pid,
    port: server.port,
    commandLine: server.commandLine
  });
  if (!result.ok) {
    log(result.error || 'Could not stop selected local server.', 'error');
    return;
  }
  log(result.message || `Stop request sent for :${server.port}.`, 'success');
  await loadPorts(true);
}

async function cancelTimer(timerId) {
  const result = await api.cancelTimer(timerId);
  if (!result.ok) {
    log(result.error || 'Could not cancel timer.', 'error');
    return;
  }
  log('Timer cancelled.', 'success');
  await loadTimers(true);
  await loadPorts(true);
}

function wireEvents() {
  elements.refreshBtn.addEventListener('click', () => loadPorts(false));
  elements.filterInput.addEventListener('input', renderPorts);
  elements.scopeFilter.addEventListener('change', renderPorts);
  elements.timerPreset.addEventListener('change', () => {
    elements.customTimerWrap.hidden = elements.timerPreset.value !== 'custom';
  });
  elements.clearLogBtn.addEventListener('click', () => clearChildren(elements.activityLog));
  elements.notifyBtn.addEventListener('click', async () => {
    if (!('Notification' in window)) {
      log('Desktop notifications are not supported here.', 'error');
      return;
    }
    const permission = await Notification.requestPermission();
    state.notifications = permission === 'granted';
    elements.notifyBtn.textContent = state.notifications ? 'Alerts enabled' : 'Enable alerts';
    log(
      state.notifications
        ? 'Desktop alerts enabled for new local servers.'
        : 'Desktop alerts were not enabled.',
      state.notifications ? 'success' : 'error'
    );
  });

  api.onRefreshRequest(() => loadPorts(false));
}

wireEvents();
loadPorts(false);
setInterval(() => loadPorts(true), 3000);
setInterval(() => {
  renderPorts();
  renderTimers();
}, 1000);
