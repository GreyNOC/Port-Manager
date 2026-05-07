process.env.GREYNOC_STOP_VERIFY_DELAY_MS = '0';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const manager = require('../lib/manager');
const state = require('../lib/state');

const server = {
  key: '4242:5173',
  pid: 4242,
  port: 5173,
  processName: 'node',
  commandLine: 'node vite.js',
  addresses: ['127.0.0.1'],
  scope: 'localhost',
  label: 'Vite',
  ownedByCurrentUser: true,
  protected: false,
  stopAllowed: true
};

async function withManager(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'greynoc-manager-'));
  const previousDir = process.env.GREYNOC_STATE_DIR;
  process.env.GREYNOC_STATE_DIR = dir;
  manager._resetForTests();
  try {
    return await fn(dir);
  } finally {
    manager._resetForTests();
    if (previousDir === undefined) delete process.env.GREYNOC_STATE_DIR;
    else process.env.GREYNOC_STATE_DIR = previousDir;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function setScannerSequence(scans) {
  let index = 0;
  manager._setScannerForTests({
    async scanListeningPorts() {
      const next = scans[Math.min(index, scans.length - 1)];
      index += 1;
      return {
        servers: next,
        errors: [],
        warnings: [],
        strategyUsed: 'test',
        strategiesTried: ['test'],
        durationMs: 0
      };
    }
  });
}

test('stopServer rejects invalid stop requests', async () => withManager(async () => {
  const result = await manager.stopServer({ pid: 'nope', port: 5173 });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'failed');
}));

test('createTimer validates timer duration before scanning', async () => withManager(async () => {
  let scanned = false;
  manager._setScannerForTests({
    async scanListeningPorts() {
      scanned = true;
      return { servers: [] };
    }
  });
  const result = await manager.createTimer({ pid: 4242, port: 5173, seconds: 2 });
  assert.equal(result.ok, false);
  assert.equal(scanned, false);
}));

test('createTimer replaces an existing pending timer for the same target', async () => withManager(async () => {
  setScannerSequence([[server]]);
  const first = await manager.createTimer({ pid: 4242, port: 5173, seconds: 60 });
  const second = await manager.createTimer({ pid: 4242, port: 5173, seconds: 120 });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  const timers = manager.listTimers();
  assert.equal(timers.length, 2);
  assert.equal(timers.find((timer) => timer.id === first.timer.id).status, 'replaced');
  assert.equal(timers.find((timer) => timer.id === second.timer.id).status, 'pending');
}));

test('createTimer stores a command-line hash instead of the raw command', async () => withManager(async () => {
  setScannerSequence([[{ ...server, commandLine: 'node server.js --token secret' }]]);
  const result = await manager.createTimer({ pid: 4242, port: 5173, seconds: 60 });
  assert.equal(result.ok, true);
  assert.equal(typeof result.timer.commandLineHash, 'string');
  assert.equal(result.timer.commandLineHash.length, 64);
  assert.equal(Object.prototype.hasOwnProperty.call(result.timer, 'commandLine'), false);
  const timers = manager.listTimers();
  assert.equal(timers[0].commandLine, undefined);
}));

test('stopServer reports command-line snapshot mismatch before killing', async () => withManager(async () => {
  setScannerSequence([[server]]);
  const originalKill = process.kill;
  let killed = false;
  process.kill = () => { killed = true; };
  try {
    const result = await manager.stopServer({ pid: 4242, port: 5173, commandLine: 'different' });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'changed-before-stop');
    assert.equal(killed, false);
  } finally {
    process.kill = originalKill;
  }
}));

test('stopServer reports signal-sent-still-running when verification still sees the listener', async () => withManager(async () => {
  setScannerSequence([[server], [server]]);
  const originalKill = process.kill;
  let killed = false;
  process.kill = () => { killed = true; };
  try {
    const result = await manager.stopServer({ pid: 4242, port: 5173, commandLine: server.commandLine });
    assert.equal(killed, true);
    assert.equal(result.ok, true);
    assert.equal(result.status, 'signal-sent-still-running');
  } finally {
    process.kill = originalKill;
  }
}));

test('processDueTimers stores the structured stop status', async () => withManager(async () => {
  const dueAt = new Date(Date.now() - 1000).toISOString();
  state.writeState({
    servers: {},
    timers: {
      due: {
        id: 'due',
        status: 'pending',
        dueAt,
        createdAt: dueAt,
        key: server.key,
        pid: server.pid,
        port: server.port,
        processName: server.processName,
        commandLine: server.commandLine
      }
    }
  });
  setScannerSequence([[server], [], []]);
  const originalKill = process.kill;
  process.kill = () => {};
  try {
    await manager.processDueTimers();
    const timer = state.readState().timers.due;
    assert.equal(timer.status, 'stopped');
    assert.match(timer.result, /closed|stopped/i);
  } finally {
    process.kill = originalKill;
  }
}));
