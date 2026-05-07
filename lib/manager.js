const { createHash, randomUUID } = require('node:crypto');
const scannerDefaults = require('./scanner');
const { readState, updateState, cleanOldServers } = require('./state');

const MAX_TIMER_SECONDS = 60 * 60 * 24;
const MIN_TIMER_SECONDS = 5;
const SCAN_INTERVAL_MS = Number(process.env.GREYNOC_SCAN_INTERVAL_MS || 3000);
const TIMER_TICK_MS = 1000;
const configuredStopVerifyDelay = Number(process.env.GREYNOC_STOP_VERIFY_DELAY_MS);
const STOP_VERIFY_DELAY_MS = Number.isFinite(configuredStopVerifyDelay) ? configuredStopVerifyDelay : 500;

let scanner = scannerDefaults;

let lastScan = {
  servers: [],
  errors: [],
  scannedAt: null,
  summary: { active: 0, newCount: 0, timers: 0, localhost: 0, localNetwork: 0 }
};

let scanInterval = null;
let timerInterval = null;
let pendingScan = null;
const scanListeners = new Set();

function nowIso() {
  return new Date().toISOString();
}

function hashCommandLine(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  return createHash('sha256').update(text).digest('hex');
}

function activeTimers(state) {
  return Object.values(state.timers || {}).filter((timer) => timer.status === 'pending');
}

function enrichServersWithTracking(servers) {
  const now = Date.now();
  const nowText = new Date(now).toISOString();
  let enriched = [];

  updateState((latestState) => {
    const nextState = cleanOldServers({ ...latestState, servers: { ...(latestState.servers || {}) } });
    nextState.servers = nextState.servers || {};

    enriched = servers.map((server) => {
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

    return nextState;
  });
  return enriched;
}

async function performRefreshScan() {
  const scan = await scanner.scanListeningPorts();
  const servers = enrichServersWithTracking(scan.servers);
  const latest = readState();
  const timers = activeTimers(latest);
  lastScan = {
    servers,
    errors: scan.errors,
    warnings: scan.warnings || [],
    strategyUsed: scan.strategyUsed || null,
    strategiesTried: scan.strategiesTried || [],
    durationMs: Number(scan.durationMs || 0),
    scannedAt: nowIso(),
    summary: {
      active: servers.length,
      newCount: servers.filter((server) => server.isNew).length,
      timers: timers.length,
      localhost: servers.filter((server) => server.scope === 'localhost').length,
      localNetwork: servers.filter((server) => server.scope === 'local-network').length
    }
  };
  for (const listener of scanListeners) {
    try { listener(lastScan); } catch (_) {}
  }
  return lastScan;
}

async function refreshScan() {
  if (pendingScan) return pendingScan;
  pendingScan = performRefreshScan().finally(() => {
    pendingScan = null;
  });
  return pendingScan;
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

function verifyCommandSnapshot(current, expected, expectedHash) {
  const a = String(current.commandLine || current.processName || '').trim();
  const b = String(expected || '').trim();
  if (expectedHash) return hashCommandLine(a) === expectedHash;
  if (!b) return true;
  if (!a) return false;
  return a === b;
}

function stopResponse(status, fields = {}) {
  const successStatuses = new Set(['stopped', 'signal-sent-still-running', 'already-closed']);
  return {
    ok: successStatuses.has(status),
    status,
    ...fields
  };
}

function sleep(ms) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findCurrentServer(request) {
  if (typeof scanner.findListeningPort === 'function') {
    try {
      const target = await scanner.findListeningPort(request);
      if (target) return target;
      return null;
    } catch (_) {}
  }
  const scan = await scanner.scanListeningPorts();
  return findMatchingServer(scan.servers || [], request) || null;
}

async function isCurrentServerListening(request) {
  if (typeof scanner.isListening === 'function') {
    try {
      return await scanner.isListening(request);
    } catch (_) {}
  }
  return Boolean(await findCurrentServer(request).catch(() => null));
}

async function stopServer(request, reason = 'manual') {
  const pid = Number(request.pid);
  const port = Number(request.port);
  if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(port) || port <= 0 || port > 65535) {
    return stopResponse('failed', { error: 'A valid PID and port are required.' });
  }

  const target = await findCurrentServer(request);
  if (!target) {
    return stopResponse('already-closed', {
      message: 'That local server is no longer listening on the selected PID and port.'
    });
  }
  if (!scanner.isStopAllowed(target)) {
    return stopResponse('blocked', {
      error: 'GreyNOC Port Manager will not stop protected, non-owned, or non-local processes.'
    });
  }
  if (!verifyCommandSnapshot(target, request.commandLine, request.commandLineHash)) {
    return stopResponse('changed-before-stop', {
      error: 'The process changed since it was selected. Refresh and try again.'
    });
  }

  if (process.platform === 'win32') {
    const owned = await scanner.checkWindowsOwnership(target.pid);
    if (owned === false) {
      return stopResponse('permission-denied', {
        error: 'That process is owned by another user. GreyNOC Port Manager will not stop it.'
      });
    }
  }

  try {
    process.kill(target.pid, 'SIGTERM');
    await sleep(STOP_VERIFY_DELAY_MS);
    const stillRunning = await isCurrentServerListening(request);
    const status = stillRunning ? 'signal-sent-still-running' : 'stopped';
    return stopResponse(status, {
      message: reason === 'timer'
        ? (stillRunning ? 'Timer sent SIGTERM, but the selected local server is still listening.' : 'Timer closed the selected local server.')
        : (stillRunning ? 'SIGTERM was sent, but the selected local server is still listening.' : 'Selected local server stopped.'),
      stopped: {
        key: target.key,
        pid: target.pid,
        port: target.port,
        processName: target.processName,
        label: target.label,
        signal: 'SIGTERM'
      }
    });
  } catch (error) {
    if (error && error.code === 'ESRCH') {
      return stopResponse('already-closed', {
        message: 'That local server closed before SIGTERM was sent.'
      });
    }
    if (error && error.code === 'EPERM') {
      return stopResponse('permission-denied', {
        error: `Permission denied stopping PID ${target.pid}.`
      });
    }
    return stopResponse('failed', { error: `Could not stop PID ${target.pid}: ${error.message}` });
  }
}

async function createTimer(request) {
  const seconds = Number(request.seconds);
  if (!Number.isFinite(seconds) || seconds < MIN_TIMER_SECONDS || seconds > MAX_TIMER_SECONDS) {
    return { ok: false, error: `Timer must be between ${MIN_TIMER_SECONDS} seconds and 24 hours.` };
  }

  const target = await findCurrentServer(request);
  if (!target) return { ok: false, error: 'That local server is no longer running.' };
  if (!scanner.isStopAllowed(target)) {
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
    commandLineHash: hashCommandLine(target.commandLine || target.processName),
    label: target.label,
    addresses: target.addresses,
    scope: target.scope,
    result: null
  };

  updateState((state) => {
    const next = { ...state, timers: { ...(state.timers || {}) } };
    for (const [id, existing] of Object.entries(next.timers)) {
      if (existing.status === 'pending' && existing.key === target.key) {
        next.timers[id] = {
          ...existing,
          status: 'replaced',
          result: 'A newer timer replaced this timer.',
          completedAt: nowIso()
        };
      }
    }
    next.timers[timer.id] = timer;
    return next;
  });
  return { ok: true, timer };
}

function cancelTimer(timerId) {
  if (typeof timerId !== 'string' || !timerId) {
    return { ok: false, error: 'A timer id is required.' };
  }
  let nextTimer = null;
  let error = null;
  updateState((state) => {
    const next = { ...state, timers: { ...(state.timers || {}) } };
    const timer = next.timers && next.timers[timerId];
    if (!timer) {
      error = 'Timer not found.';
      return next;
    }
    if (timer.status !== 'pending') {
      error = `Timer is already ${timer.status}.`;
      return next;
    }
    nextTimer = {
      ...timer,
      status: 'cancelled',
      completedAt: nowIso(),
      result: 'Cancelled by user.'
    };
    next.timers[timerId] = nextTimer;
    return next;
  });
  if (error) return { ok: false, error };
  return { ok: true, timer: nextTimer };
}

async function processDueTimers() {
  const state = readState();
  const timers = Object.values(state.timers || {}).filter((timer) => timer.status === 'pending');
  const due = timers.filter((timer) => Date.parse(timer.dueAt) <= Date.now());
  if (!due.length) return;

  for (const timer of due) {
    const result = await stopServer(timer, 'timer');
    updateState((latest) => {
      const next = { ...latest, timers: { ...(latest.timers || {}) } };
      const liveTimer = next.timers[timer.id];
      if (!liveTimer || liveTimer.status !== 'pending') return next;
      next.timers[timer.id] = {
        ...liveTimer,
        status: result.status || (result.ok ? 'completed' : 'failed'),
        completedAt: nowIso(),
        result: result.message || result.error || result.status
      };
      return next;
    });
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

function onScanUpdated(listener) {
  if (typeof listener !== 'function') return () => {};
  scanListeners.add(listener);
  return () => scanListeners.delete(listener);
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
  stopBackgroundJobs,
  onScanUpdated,
  _setScannerForTests(nextScanner) {
    scanner = { ...scannerDefaults, ...nextScanner };
    if (!Object.prototype.hasOwnProperty.call(nextScanner, 'findListeningPort')) {
      delete scanner.findListeningPort;
    }
    if (!Object.prototype.hasOwnProperty.call(nextScanner, 'isListening')) {
      delete scanner.isListening;
    }
  },
  _resetForTests() {
    scanner = scannerDefaults;
    stopBackgroundJobs();
    scanListeners.clear();
    pendingScan = null;
    lastScan = {
      servers: [],
      errors: [],
      warnings: [],
      scannedAt: null,
      summary: { active: 0, newCount: 0, timers: 0, localhost: 0, localNetwork: 0 }
    };
  }
};
