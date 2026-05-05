const { execFile } = require('node:child_process');
const os = require('node:os');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const LOCALHOST_VALUES = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);
const WILDCARD_VALUES = new Set(['*', '*4', '*6', '0.0.0.0', '::', '[::]', '']);

const DEV_HINTS = [
  { test: /\b(vite|vite-node)\b/i, label: 'Vite' },
  { test: /\b(next|next-server)\b/i, label: 'Next.js' },
  { test: /\b(react-scripts|webpack-dev-server)\b/i, label: 'React' },
  { test: /\b(astro)\b/i, label: 'Astro' },
  { test: /\b(nuxt)\b/i, label: 'Nuxt' },
  { test: /\b(svelte|sveltekit)\b/i, label: 'Svelte' },
  { test: /\b(flask)\b/i, label: 'Flask' },
  { test: /\b(django|manage\.py runserver)\b/i, label: 'Django' },
  { test: /\b(rails|puma)\b/i, label: 'Rails' },
  { test: /\b(uvicorn|fastapi|hypercorn)\b/i, label: 'FastAPI' },
  { test: /\b(nodemon|ts-node|node)\b/i, label: 'Node' },
  { test: /\b(docker-proxy|com\.docker|docker)\b/i, label: 'Docker' },
  { test: /\b(java|spring-boot)\b/i, label: 'Java' },
  { test: /\b(php|artisan)\b/i, label: 'PHP' },
  { test: /\b(go|air)\b/i, label: 'Go' }
];

const COMMON_PORTS = new Map([
  [3000, 'React / Next.js / Node'],
  [3001, 'React / Next.js / Node'],
  [4200, 'Angular'],
  [5000, 'Flask / Python'],
  [5173, 'Vite'],
  [5174, 'Vite'],
  [5432, 'PostgreSQL'],
  [6379, 'Redis'],
  [8000, 'Django / Python'],
  [8080, 'Web server / proxy'],
  [8888, 'Jupyter'],
  [9000, 'Dev service'],
  [9229, 'Node inspector']
]);

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 6000, maxBuffer: 1024 * 1024 * 8, ...options }, (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr || '').trim().split(/\r?\n/).slice(0, 4).join(' | ');
        if (detail) {
          error.message = `${error.message.split('\n')[0]} -- ${detail}`;
        }
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve(String(stdout || ''));
    });
  });
}

function normalizeAddress(value) {
  let address = String(value || '').trim();
  address = address.replace(/^\[/, '').replace(/\]$/, '');
  if (address === '::ffff:127.0.0.1') return '127.0.0.1';
  if (address === '::1') return '::1';
  return address;
}

function classifyAddress(value) {
  const address = normalizeAddress(value);
  if (LOCALHOST_VALUES.has(address)) return 'localhost';
  if (WILDCARD_VALUES.has(address)) return 'local-network';
  if (isPrivateAddress(address)) return 'local-network';
  return 'external-or-system';
}

function isPrivateAddress(address) {
  if (!address) return false;
  if (/^10\./.test(address)) return true;
  if (/^192\.168\./.test(address)) return true;
  if (/^169\.254\./.test(address)) return true;
  const parts = address.split('.').map(Number);
  if (parts.length === 4 && parts.every(Number.isFinite)) {
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  }
  if (/^(fe80|fc|fd)/i.test(address)) return true;
  return false;
}

function parseEndpoint(endpoint) {
  const cleaned = String(endpoint || '')
    .replace(/\s*\(LISTEN\)\s*$/i, '')
    .replace(/^TCP\s+/i, '')
    .trim();

  const ipv6Bracket = cleaned.match(/^\[?([^\]]+)\]?:([0-9]+)$/);
  if (ipv6Bracket && ipv6Bracket[2]) {
    return { address: normalizeAddress(ipv6Bracket[1]), port: Number(ipv6Bracket[2]) };
  }

  const wildcard = cleaned.match(/^\*:([0-9]+)$/);
  if (wildcard) return { address: '*', port: Number(wildcard[1]) };

  const lastColon = cleaned.lastIndexOf(':');
  if (lastColon !== -1) {
    const address = cleaned.slice(0, lastColon);
    const port = Number(cleaned.slice(lastColon + 1));
    if (Number.isFinite(port)) return { address: normalizeAddress(address), port };
  }

  return { address: cleaned, port: null };
}

function isValidPid(pid) {
  return Number.isInteger(pid) && pid > 0 && pid <= 0xffffffff;
}

function readCommandLine(pid, fallback = '') {
  if (!isValidPid(pid)) return fallback || '';
  if (process.platform === 'linux') {
    try {
      const raw = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      const cmd = raw.replace(/\u0000/g, ' ').trim();
      if (cmd) return cmd;
    } catch (_) {}
  }
  return fallback || '';
}

async function getCommandLine(pid, fallback = '') {
  if (!isValidPid(pid)) return fallback || '';
  if (process.platform === 'linux') return readCommandLine(pid, fallback);
  if (process.platform === 'darwin') {
    try {
      const out = await run('ps', ['-p', String(pid), '-o', 'command=']);
      return out.trim() || fallback || '';
    } catch (_) {
      return fallback || '';
    }
  }
  return fallback || '';
}

function inferLabel(processName, commandLine, port) {
  const text = `${processName || ''} ${commandLine || ''}`.trim();
  for (const hint of DEV_HINTS) {
    if (hint.test.test(text)) return hint.label;
  }
  return COMMON_PORTS.get(Number(port)) || 'Local server';
}

function isProtectedPid(pid) {
  const protectedPids = new Set([0, 1, process.pid, process.ppid]);
  if (process.platform === 'win32') {
    protectedPids.add(4);
  }
  return protectedPids.has(Number(pid));
}

function isOwnedByCurrentUser(pid) {
  if (!isValidPid(pid)) return false;
  if (process.platform === 'linux') {
    if (typeof process.getuid !== 'function') return null;
    const currentUid = process.getuid();
    try {
      const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
      const uidLine = status.split(/\r?\n/).find((line) => line.startsWith('Uid:'));
      if (!uidLine) return null;
      const realUid = Number(uidLine.trim().split(/\s+/)[1]);
      return realUid === currentUid;
    } catch (_) {
      return null;
    }
  }
  if (process.platform === 'darwin') {
    if (typeof process.getuid !== 'function') return null;
    const currentUid = process.getuid();
    try {
      const out = execFileSync('ps', ['-p', String(pid), '-o', 'uid='], { timeout: 3000, encoding: 'utf8' });
      const uid = Number(out.trim());
      return uid === currentUid;
    } catch (_) {
      return null;
    }
  }
  return null;
}

function isStopAllowed(entry) {
  if (!entry || !entry.pid || !entry.port) return false;
  if (isProtectedPid(entry.pid)) return false;
  if (entry.ownedByCurrentUser === false) return false;
  if (entry.scope === 'external-or-system') return false;
  return true;
}

function aggregate(entries) {
  const byKey = new Map();
  for (const entry of entries) {
    if (!entry.pid || !entry.port || entry.port < 1 || entry.port > 65535) continue;
    const scope = classifyAddress(entry.address);
    if (scope === 'external-or-system') continue;
    const key = `${entry.pid}:${entry.port}`;
    const existing = byKey.get(key);
    const command = readCommandLine(entry.pid, entry.commandLine || entry.processName || '');
    if (existing) {
      existing.addresses = Array.from(new Set([...existing.addresses, normalizeAddress(entry.address)]));
      if (scope === 'localhost') existing.scope = 'localhost';
      if (!existing.commandLine && command) existing.commandLine = command;
      continue;
    }
    const processName = entry.processName || 'unknown';
    byKey.set(key, {
      key,
      pid: Number(entry.pid),
      port: Number(entry.port),
      protocol: entry.protocol || 'tcp',
      processName,
      commandLine: command || processName,
      addresses: [normalizeAddress(entry.address)],
      scope,
      label: inferLabel(processName, command, entry.port),
      ownedByCurrentUser: isOwnedByCurrentUser(entry.pid),
      stopAllowed: false,
      protected: false
    });
  }

  return Array.from(byKey.values()).map((entry) => {
    const protectedPid = isProtectedPid(entry.pid);
    return {
      ...entry,
      protected: protectedPid,
      stopAllowed: isStopAllowed({ ...entry, protected: protectedPid })
    };
  }).sort((a, b) => a.port - b.port || a.pid - b.pid);
}

async function scanWithLsof() {
  const out = await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pcn']);
  const entries = [];
  let current = {};

  for (const line of out.split(/\r?\n/)) {
    if (!line) continue;
    const code = line[0];
    const value = line.slice(1);
    if (code === 'p') {
      current = { pid: Number(value) };
    } else if (code === 'c') {
      current.processName = value;
    } else if (code === 'n') {
      const endpoint = parseEndpoint(value);
      if (endpoint.port) {
        entries.push({
          ...current,
          address: endpoint.address,
          port: endpoint.port,
          protocol: 'tcp',
          commandLine: current.processName || ''
        });
      }
    }
  }
  return aggregate(entries);
}

async function scanWithSs() {
  const out = await run('ss', ['-ltnp']);
  const entries = [];
  for (const line of out.split(/\r?\n/).slice(1)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    const localAddress = parts[3] || '';
    const endpoint = parseEndpoint(localAddress);
    if (!endpoint.port) continue;
    const pidMatch = trimmed.match(/pid=(\d+)/);
    const procMatch = trimmed.match(/"([^"]+)"/);
    const pid = pidMatch ? Number(pidMatch[1]) : null;
    if (!pid) continue;
    entries.push({
      pid,
      processName: procMatch ? procMatch[1] : 'unknown',
      commandLine: readCommandLine(pid, procMatch ? procMatch[1] : ''),
      address: endpoint.address,
      port: endpoint.port,
      protocol: 'tcp'
    });
  }
  return aggregate(entries);
}

async function scanWithNetstat() {
  const out = await run('netstat', ['-ltnp']);
  const entries = [];
  for (const line of out.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!/^tcp/i.test(trimmed)) continue;
    const parts = trimmed.split(/\s+/);
    const localAddress = parts[3] || '';
    const state = parts[5] || '';
    const pidProgram = parts[6] || '';
    if (!/LISTEN/i.test(state)) continue;
    const endpoint = parseEndpoint(localAddress);
    const pidMatch = pidProgram.match(/^(\d+)\//);
    if (!endpoint.port || !pidMatch) continue;
    const pid = Number(pidMatch[1]);
    const processName = pidProgram.replace(/^\d+\//, '') || 'unknown';
    entries.push({
      pid,
      processName,
      commandLine: readCommandLine(pid, processName),
      address: endpoint.address,
      port: endpoint.port,
      protocol: 'tcp'
    });
  }
  return aggregate(entries);
}

const SCANNER_VERSION = 'greynoc-scanner-v3-2026-05-05';

if (process.env.GREYNOC_DEBUG_SCANNER) {
  console.error(`[greynoc] scanner.js loaded (${SCANNER_VERSION}) at ${new Date().toISOString()}`);
}

async function scanWithPowerShell() {
  const script = `
# ${SCANNER_VERSION}
$ErrorActionPreference = 'SilentlyContinue'
$conns = Get-NetTCPConnection -State Listen
$uniqueIds = @($conns | Select-Object -ExpandProperty OwningProcess -Unique)
$cmdMap = @{}
$nameMap = @{}
foreach ($procId in $uniqueIds) {
  if (-not $procId) { continue }
  $win = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$procId)"
  if ($win) {
    if ($win.CommandLine) { $cmdMap[[int]$procId] = $win.CommandLine }
    if ($win.Name) { $nameMap[[int]$procId] = [System.IO.Path]::GetFileNameWithoutExtension($win.Name) }
  }
  if (-not $nameMap.ContainsKey([int]$procId)) {
    $proc = Get-Process -Id $procId
    if ($proc) { $nameMap[[int]$procId] = $proc.ProcessName }
  }
}
$rows = foreach ($c in $conns) {
  $procId = [int]$c.OwningProcess
  $name = if ($nameMap.ContainsKey($procId)) { $nameMap[$procId] } else { 'unknown' }
  $cmd = if ($cmdMap.ContainsKey($procId)) { $cmdMap[$procId] } else { $name }
  [PSCustomObject]@{
    LocalAddress = $c.LocalAddress
    LocalPort = $c.LocalPort
    OwningProcess = $procId
    ProcessName = $name
    CommandLine = $cmd
  }
}
$rows | ConvertTo-Json -Compress
`;
  const out = await run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { timeout: 15000 }
  );
  const parsed = out.trim() ? JSON.parse(out) : [];
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const entries = rows
    .filter(Boolean)
    .map((row) => ({
      pid: Number(row.OwningProcess),
      processName: row.ProcessName || 'unknown',
      commandLine: row.CommandLine || row.ProcessName || 'unknown',
      address: row.LocalAddress,
      port: Number(row.LocalPort),
      protocol: 'tcp'
    }));
  return aggregate(entries);
}

async function checkWindowsOwnership(pid) {
  if (process.platform !== 'win32' || !isValidPid(pid)) return null;
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$me = ([System.Security.Principal.WindowsIdentity]::GetCurrent()).User.Value
$win = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"
if (-not $win) { Write-Output 'missing'; exit 0 }
$ownerSid = $null
try {
  $sidObj = Invoke-CimMethod -InputObject $win -MethodName GetOwnerSid
  if ($sidObj -and $sidObj.ReturnValue -eq 0 -and $sidObj.Sid) { $ownerSid = $sidObj.Sid }
} catch {}
if (-not $ownerSid) { Write-Output 'unknown'; exit 0 }
if ($ownerSid -eq $me) { Write-Output 'self' } else { Write-Output 'other' }
`;
  try {
    const out = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: 8000 }
    );
    const trimmed = out.trim();
    if (trimmed === 'self') return true;
    if (trimmed === 'other') return false;
    return null;
  } catch (_) {
    return null;
  }
}

async function scanListeningPorts() {
  const errors = [];
  const strategies = process.platform === 'win32'
    ? [scanWithPowerShell]
    : [scanWithLsof, scanWithSs, scanWithNetstat];

  for (const strategy of strategies) {
    try {
      const result = await strategy();
      return { servers: result, errors };
    } catch (error) {
      errors.push(`${strategy.name}: ${error.message}`);
    }
  }

  return { servers: [], errors };
}

module.exports = {
  scanListeningPorts,
  isStopAllowed,
  isProtectedPid,
  isOwnedByCurrentUser,
  checkWindowsOwnership,
  classifyAddress,
  inferLabel
};
