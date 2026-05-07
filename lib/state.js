const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_STATE = {
  servers: {},
  timers: {},
  createdAt: null,
  updatedAt: null
};

function secureDirectoryOptions() {
  return process.platform === 'win32'
    ? { recursive: true }
    : { recursive: true, mode: 0o700 };
}

function secureFileOptions() {
  return process.platform === 'win32'
    ? undefined
    : { mode: 0o600 };
}

function getStateDir() {
  const dir = process.env.GREYNOC_STATE_DIR;
  if (!dir) {
    throw new Error('GREYNOC_STATE_DIR is not set. The desktop app must initialize it before reading state.');
  }
  return path.resolve(dir);
}

function getStateFile() {
  return path.join(getStateDir(), 'state.json');
}

function ensureStateFile() {
  const dir = getStateDir();
  const file = path.join(dir, 'state.json');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, secureDirectoryOptions());
  }
  if (!fs.existsSync(file)) {
    const stamp = new Date().toISOString();
    fs.writeFileSync(
      file,
      JSON.stringify({ ...DEFAULT_STATE, createdAt: stamp, updatedAt: stamp }, null, 2),
      secureFileOptions()
    );
  }
}

function freshState() {
  const stamp = new Date().toISOString();
  return { ...DEFAULT_STATE, createdAt: stamp, updatedAt: stamp };
}

function readState() {
  ensureStateFile();
  try {
    const raw = fs.readFileSync(getStateFile(), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_STATE,
      ...parsed,
      servers: parsed.servers && typeof parsed.servers === 'object' ? parsed.servers : {},
      timers: parsed.timers && typeof parsed.timers === 'object' ? parsed.timers : {}
    };
  } catch (error) {
    const recovered = freshState();
    try {
      const file = getStateFile();
      const corruptFile = `${file}.corrupt-${Date.now()}`;
      if (fs.existsSync(file)) fs.renameSync(file, corruptFile);
    } catch (_) {}
    writeState(recovered);
    return recovered;
  }
}

function writeState(state) {
  const dir = getStateDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, secureDirectoryOptions());
  }
  const next = {
    ...DEFAULT_STATE,
    ...state,
    updatedAt: new Date().toISOString()
  };
  if (!next.createdAt) next.createdAt = next.updatedAt;
  const file = getStateFile();
  const tmp = `${file}.${process.pid}.tmp`;
  const data = JSON.stringify(next, null, 2);
  fs.writeFileSync(tmp, data, secureFileOptions());
  try {
    fs.renameSync(tmp, file);
  } catch (error) {
    if (process.platform === 'win32' && (error.code === 'EPERM' || error.code === 'EEXIST')) {
      try {
        fs.copyFileSync(tmp, file);
        try { fs.unlinkSync(tmp); } catch (_) {}
        return next;
      } catch (replaceError) {
        try { fs.unlinkSync(tmp); } catch (_) {}
        throw replaceError;
      }
    }
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw error;
  }
  return next;
}

function updateState(mutator) {
  if (typeof mutator !== 'function') {
    throw new TypeError('updateState requires a mutator function.');
  }
  const current = readState();
  const result = mutator(current);
  return writeState(result || current);
}

function cleanOldServers(state, olderThanMs = 1000 * 60 * 60 * 24 * 14) {
  const now = Date.now();
  const servers = { ...state.servers };
  for (const [key, record] of Object.entries(servers)) {
    const lastSeen = Date.parse(record.lastSeen || record.firstSeen || 0);
    if (!Number.isFinite(lastSeen) || now - lastSeen > olderThanMs) {
      delete servers[key];
    }
  }
  return { ...state, servers };
}

module.exports = {
  readState,
  writeState,
  updateState,
  cleanOldServers
};
