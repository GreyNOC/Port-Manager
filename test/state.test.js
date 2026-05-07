const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const state = require('../lib/state');

function withTempState(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'greynoc-state-'));
  const previous = process.env.GREYNOC_STATE_DIR;
  process.env.GREYNOC_STATE_DIR = dir;
  try {
    return fn(dir);
  } finally {
    if (previous === undefined) delete process.env.GREYNOC_STATE_DIR;
    else process.env.GREYNOC_STATE_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('readState creates a state file when missing', () => withTempState((dir) => {
  const data = state.readState();
  const file = path.join(dir, 'state.json');
  assert.equal(fs.existsSync(file), true);
  assert.deepEqual(data.servers, {});
  assert.deepEqual(data.timers, {});
  assert.ok(data.createdAt);
  assert.ok(data.updatedAt);
}));

test('readState recovers from corrupted JSON and preserves a corrupt copy', () => withTempState((dir) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), '{not json');
  const data = state.readState();
  const files = fs.readdirSync(dir);
  assert.deepEqual(data.servers, {});
  assert.deepEqual(data.timers, {});
  assert.equal(files.some((name) => name.startsWith('state.json.corrupt-')), true);
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')));
}));

test('cleanOldServers removes stale records and keeps fresh records', () => {
  const fresh = new Date().toISOString();
  const stale = new Date(Date.now() - 1000 * 60 * 60).toISOString();
  const cleaned = state.cleanOldServers({
    servers: {
      fresh: { lastSeen: fresh },
      stale: { lastSeen: stale }
    },
    timers: {}
  }, 1000);
  assert.deepEqual(Object.keys(cleaned.servers), ['fresh']);
});

test('writeState uses an atomic temp file and leaves valid JSON behind', () => withTempState((dir) => {
  const written = state.writeState({ servers: { a: { port: 3000 } }, timers: {} });
  const files = fs.readdirSync(dir);
  assert.equal(files.includes('state.json'), true);
  assert.equal(files.some((name) => name.endsWith('.tmp')), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).servers, written.servers);
  if (process.platform !== 'win32') {
    const mode = fs.statSync(path.join(dir, 'state.json')).mode & 0o777;
    assert.equal(mode & 0o077, 0);
  }
}));

test('updateState re-reads current state before applying the mutator', () => withTempState(() => {
  state.writeState({ servers: { first: { port: 3000 } }, timers: {} });
  const updated = state.updateState((current) => ({
    ...current,
    servers: {
      ...current.servers,
      second: { port: 5173 }
    }
  }));
  assert.deepEqual(Object.keys(updated.servers).sort(), ['first', 'second']);
}));
