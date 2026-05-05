const { randomUUID } = require('node:crypto');
const { scanListeningPorts, isStopAllowed, checkWindowsOwnership } = require('./scanner');
const { readState, writeState, cleanOldServers } = require('./state');

const MAX_TIMER_SECONDS = 60 * 60 * 24;
const MIN_TIMER_SECONDS = 5;
const SCAN_INTERVAL_MS = Number(process.env.GREYNOC_SCAN_INTERVAL_MS || 3000);
const TIMER_TICK_MS = 1000;

let lastScan = {
  servers: [],
  errors: [],
  scannedAt: null,
  summary: { active: 0, newCount: 0, timers: 0, localhost: 0, localNetwork: 0 }
};

let scanInterval = null;
let timerInterval = null;

function nowIso() {
  return new Date().toISOString();
}

function activeTimers(state) {
  return Object.values(state.timers || {}).filter((timer) => timer.status === 'pending');
}

function enrichServersWithTracking(servers, state) {
  const now = Date.now();
  const nowText = new Date(now).toISOString();
  const nextState = cleanOldServers(state);
  nextState.servers = nextState.servers || {};

  const enriched = servers.map((server) => {
    const existing = nextState.servers[server.key] || {};
    const firstSeen = existing.firstSeen || nowText;
    const firstSeenMs = Date.parse(firstSeen);
    const aliveMs = Number.isFinite(firstSeenMs) ? Math.max(0, now - firstSeenMs) : 0;
    const seenCount = Number(existing.seenCount || 0) + 1;
    const isNew = now - Date.parse(firstSeen) < 15000 && seenCount <= 5;

    nextState.servers[server.key] = {
      firstSeen,
      lastSeen: nowText,
      seenCount,
      pid: server.pid,
      port: server.port,
      processName: server.processName,
      commandLine: server.commandLine,
      scope: server.scope,
      label: server.label
    };

    const pendingTimer = activeTimers(nextState).find(
      (timer) => timer.key === server.key || (timer.pid === server.pid && timer.port === server.port)
    );

    return {
      ...server,
      firstSeen,
      lastSeen: nowText,
      aliveMs,
      aliveSeconds: Math.floor(aliveMs / 1000),
      seenCount,
      isNew,
      timer: pendingTimer || null
    };
  });

  writeState(nextState);
  return enriched;
}

async function refreshScan() {
  const state = readState();
  const scan = await scanListeningPorts();
  const servers = enrichServersWithTracking(scan.servers, state);
  const latest = readState();
  const timers = activeTimers(latest);
  lastScan = {
    servers,
    errors: scan.errors,
    scannedAt: nowIso(),
    summary: {
      active: servers.length,
      newCount: servers.filter((server) => server.isNew).length,
      timers: timers.length,
      localhost: servers.filter((server) => server.scope === 'localhost').length,
      localNetwork: servers.filter((server) => server.scope === 'local-network').length
    }
  };
  return lastScan;
}

function getLastScan() {
  return lastScan;
}

function listTimers() {
  const state = readState();
  return Object.values(state.timers || {}).sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
  );
}

function findMatchingServer(servers, request) {
  const pid = Number(request.pid);
  const port = Number(request.port);
  const key = request.key ? String(request.key) : `${pid}:${port}`;
  return (
    servers.find((server) => server.key === key && server.pid === pid && server.port === port) ||
    servers.find((server) => server.pid === pid && server.port === port)
  );
}

function verifyCommandSnapshot(current, expected) {
  const a = String(current.commandLine || current.processName || '').trim();
  const b = String(expected || '').trim();
  if (!b) return true;
  if (!a) return false;
  return a === b;
}

async function stopServer(request, reason = 'manual') {
  const pid = Number(request.pid);
  const port = Number(request.port);
  if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(port) || port <= 0 || port > 65535) {
    return { ok: false, error: 'A valid PID and port are required.' };
  }

  const scan = await scanListeningPorts();
  const target = findMatchingServer(scan.servers, request);
  if (!target) {
    return { ok: false, error: 'That local server is no longer running on the selected PID and port.' };
  }
  if (!isStopAllowed(target)) {
    return { ok: false, error: 'GreyNOC Port Manager will not stop protected or non-local processes.' };
  }
  if (!verifyCommandSnapshot(target, request.commandLine)) {
    return { ok: false, error: 'The process changed since it was selected. Refresh and try again.' };
  }

  if (process.platform === 'win32') {
    const owned = await checkWindowsOwnership(target.pid);
    if (owned === false) {
      return { ok: false, error: 'That process is owned by another user. GreyNOC Port Manager will not stop it.' };
    }
  }

  try {
    process.kill(target.pid, 'SIGTERM');
    return {
      ok: true,
      message: reason === 'timer'
        ? 'Timer closed the selected local server.'
        : 'Selected local server was asked to stop.',
      stopped: {
        key: target.key,
        pid: target.pid,
        port: target.port,
        processName: target.processName,
        label: target.label,
        signal: 'SIGTERM'
      }
    };
  } catch (error) {
    return { ok: false, error: `Could not stop PID ${target.pid}: ${error.message}` };
  }
}

async function createTimer(request) {
  const seconds = Number(request.seconds);
  if (!Number.isFinite(seconds) || seconds < MIN_TIMER_SECONDS || seconds > MAX_TIMER_SECONDS) {
    return { ok: false, error: `Timer must be between ${MIN_TIMER_SECONDS} seconds and 24 hours.` };
  }

  const scan = await scanListeningPorts();
  const target = findMatchingServer(scan.servers, request);
  if (!target) return { ok: false, error: 'That local server is no longer running.' };
  if (!isStopAllowed(target)) {
    return { ok: false, error: 'This process is protected or not local, so a timer cannot be set for it.' };
  }

  const now = Date.now();
  const timer = {
    id: randomUUID(),
    status: 'pending',
    createdAt: new Date(now).toISOString(),
    dueAt: new Date(now + Math.floor(seconds * 1000)).toISOString(),
    seconds: Math.floor(seconds),
    key: target.key,
    pid: target.pid,
    port: target.port,
    processName: target.processName,
    commandLine: target.commandLine,
    label: target.label,
    addresses: target.addresses,
    scope: target.scope,
    result: null
  };

  const state = readState();
  state.timers = state.timers || {};
  for (const existing of Object.values(state.timers)) {
    if (existing.status === 'pending' && existing.key === target.key) {
      existing.status = 'replaced';
      existing.result = 'A newer timer replaced this timer.';
      existing.completedAt = nowIso();
    }
  }
  state.timers[timer.id] = timer;
  writeState(state);
  return { ok: true, timer };
}

function cancelTimer(timerId) {
  if (typeof timerId !== 'string' || !timerId) {
    return { ok: false, error: 'A timer id is required.' };
  }
  const state = readState();
  const timer = state.timers && state.timers[timerId];
  if (!timer) return { ok: false, error: 'Timer not found.' };
  if (timer.status !== 'pending') return { ok: false, error: `Timer is already ${timer.status}.` };
  timer.status = 'cancelled';
  timer.completedAt = nowIso();
  timer.result = 'Cancelled by user.';
  writeState(state);
  return { ok: true, timer };
}

async function processDueTimers() {
  const state = readState();
  const timers = Object.values(state.timers || {}).filter((timer) => timer.status === 'pending');
  const due = timers.filter((timer) => Date.parse(timer.dueAt) <= Date.now());
  if (!due.length) return;

  for (const timer of due) {
    const result = await stopServer(timer, 'timer');
    const latest = readState();
    const liveTimer = latest.timers[timer.id];
    if (!liveTimer || liveTimer.status !== 'pending') continue;
    liveTimer.status = result.ok
      ? 'completed'
      : (/no longer running/i.test(result.error || '') ? 'already-closed' : 'failed');
    liveTimer.completedAt = nowIso();
    liveTimer.result = result.ok ? result.message : result.error;
    latest.timers[timer.id] = liveTimer;
    writeState(latest);
  }
  await refreshScan();
}

function startBackgroundJobs() {
  if (!scanInterval) {
    scanInterval = setInterval(() => {
      refreshScan().catch(() => {});
    }, SCAN_INTERVAL_MS);
    scanInterval.unref?.();
  }
  if (!timerInterval) {
    timerInterval = setInterval(() => {
      processDueTimers().catch(() => {});
    }, TIMER_TICK_MS);
    timerInterval.unref?.();
  }
}

function stopBackgroundJobs() {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

module.exports = {
  refreshScan,
  getLastScan,
  listTimers,
  stopServer,
  createTimer,
  cancelTimer,
  processDueTimers,
  startBackgroundJobs,
  stopBackgroundJobs
};
