#!/usr/bin/env node

const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline/promises');

const APP_NAME = 'GreyNOC Port Manager';

function defaultStateDir() {
  if (process.platform === 'win32') {
    const root = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(root, APP_NAME, 'state');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', APP_NAME, 'state');
  }
  const root = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(root, APP_NAME, 'state');
}

process.env.GREYNOC_STATE_DIR = process.env.GREYNOC_STATE_DIR || defaultStateDir();

const manager = require('../lib/manager');
const pkg = require('../package.json');

function printHelp() {
  console.log(`GreyNOC Port Manager CLI

Usage:
  greynoc-port-manager <command> [options]

Commands:
  list, scan                 Scan and list local listening ports
  stop                       Stop a local server by PID and port
  timer list                 List timers
  timer set                  Set an auto-close timer for a PID and port
  timer cancel <id>          Cancel a pending timer
  timer run-due              Process timers that are due now
  state-dir                  Print the state directory

Options:
  --json                     Print machine-readable JSON
  --scope <scope>            all, localhost, or local-network
  --filter <text>            Filter list output by process, port, label, or address
  --pid <pid>                Target process id
  --port <port>              Target port
  --key <key>                Target key from list output, usually pid:port
  --command-line <text>      Expected command-line snapshot for stop verification
  --seconds <seconds>        Timer duration in seconds
  --yes, -y                  Skip interactive confirmation
  --help, -h                 Show help
  --version, -v              Show version

Examples:
  greynoc-port-manager list
  greynoc-port-manager list --json
  greynoc-port-manager stop --pid 1234 --port 5173
  greynoc-port-manager timer set --pid 1234 --port 5173 --seconds 300
`);
}

function parseArgv(argv) {
  const result = { _: [], options: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('-')) {
      result._.push(arg);
      continue;
    }
    if (arg === '--') {
      result._.push(...argv.slice(i + 1));
      break;
    }
    const equal = arg.indexOf('=');
    const name = arg.replace(/^-+/, '');
    if (equal !== -1) {
      result.options[arg.slice(0, equal).replace(/^-+/, '')] = arg.slice(equal + 1);
      continue;
    }
    if (arg === '-y') {
      result.options.yes = true;
      continue;
    }
    if (arg === '-h') {
      result.options.help = true;
      continue;
    }
    if (arg === '-v') {
      result.options.version = true;
      continue;
    }
    const next = argv[i + 1];
    const takesValue = new Set(['scope', 'filter', 'pid', 'port', 'key', 'command-line', 'seconds']);
    if (takesValue.has(name)) {
      result.options[name] = next;
      i += 1;
    } else {
      result.options[name] = true;
    }
  }
  return result;
}

function toInt(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n)) {
    throw new Error(`${label} must be an integer.`);
  }
  return n;
}

function buildRequest(options) {
  const request = {};
  if (options.pid !== undefined) request.pid = toInt(options.pid, 'PID');
  if (options.port !== undefined) request.port = toInt(options.port, 'Port');
  if (options.key !== undefined) request.key = String(options.key);
  if (options['command-line'] !== undefined) request.commandLine = String(options['command-line']);
  if (options.seconds !== undefined) request.seconds = Number(options.seconds);
  return request;
}

function filterServers(servers, options) {
  const scope = options.scope || 'all';
  if (!['all', 'localhost', 'local-network'].includes(scope)) {
    throw new Error('--scope must be all, localhost, or local-network.');
  }
  const query = String(options.filter || '').trim().toLowerCase();
  return servers.filter((server) => {
    if (scope !== 'all' && server.scope !== scope) return false;
    if (!query) return true;
    const text = [
      server.key,
      server.pid,
      server.port,
      server.processName,
      server.commandLine,
      server.label,
      server.scope,
      (server.addresses || []).join(' ')
    ].join(' ').toLowerCase();
    return text.includes(query);
  });
}

function pad(value, width) {
  return String(value == null ? '' : value).padEnd(width).slice(0, width);
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function printServers(data, options) {
  const servers = filterServers(data.servers || [], options);
  if (options.json) {
    console.log(JSON.stringify({ ...data, servers }, null, 2));
    return;
  }
  if (!servers.length) {
    console.log('No local listening ports found.');
    return;
  }
  console.log(`${servers.length} local listening port${servers.length === 1 ? '' : 's'} found`);
  console.log('');
  console.log(`${pad('PORT', 7)} ${pad('PID', 8)} ${pad('SCOPE', 14)} ${pad('ALIVE', 9)} ${pad('PROCESS', 18)} LABEL`);
  for (const server of servers) {
    console.log([
      pad(`:${server.port}`, 7),
      pad(server.pid, 8),
      pad(server.scope, 14),
      pad(formatDuration(server.aliveSeconds), 9),
      pad(server.processName, 18),
      server.label || ''
    ].join(' '));
    console.log(`  key=${server.key} addresses=${(server.addresses || []).join(', ')} stopAllowed=${server.stopAllowed ? 'yes' : 'no'}`);
    if (server.commandLine) console.log(`  command=${server.commandLine}`);
  }
  if (data.errors && data.errors.length) {
    console.error(`Scanner warnings: ${data.errors.join(' | ')}`);
  }
}

function printTimers(timers, json) {
  if (json) {
    console.log(JSON.stringify({ timers }, null, 2));
    return;
  }
  if (!timers.length) {
    console.log('No timers found.');
    return;
  }
  console.log(`${pad('STATUS', 15)} ${pad('DUE', 24)} ${pad('PORT', 7)} ${pad('PID', 8)} ID`);
  for (const timer of timers) {
    console.log([
      pad(timer.status, 15),
      pad(timer.dueAt || '', 24),
      pad(`:${timer.port}`, 7),
      pad(timer.pid, 8),
      timer.id
    ].join(' '));
    if (timer.result) console.log(`  result=${timer.result}`);
  }
}

async function confirm(options, message) {
  if (options.yes) return true;
  if (!process.stdin.isTTY) {
    throw new Error('Confirmation is required. Re-run with --yes to continue from a non-interactive shell.');
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${message} Type yes to continue: `);
    return answer.trim().toLowerCase() === 'yes';
  } finally {
    rl.close();
  }
}

async function commandList(options) {
  const data = await manager.refreshScan();
  printServers(data, options);
}

async function commandStop(options) {
  const request = buildRequest(options);
  if (!request.pid || !request.port) throw new Error('stop requires --pid and --port.');
  const ok = await confirm(options, `Stop PID ${request.pid} on port ${request.port}?`);
  if (!ok) {
    console.log('Cancelled.');
    return;
  }
  const result = await manager.stopServer(request, 'manual');
  await manager.refreshScan().catch(() => {});
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(result.message);
  } else {
    throw new Error(result.error || 'Could not stop selected server.');
  }
  if (!result.ok) process.exitCode = 1;
}

async function commandTimer(args, options) {
  const subcommand = args[1] || 'list';
  if (subcommand === 'list' || subcommand === 'ls') {
    printTimers(manager.listTimers(), options.json);
    return;
  }
  if (subcommand === 'set' || subcommand === 'create') {
    const request = buildRequest(options);
    if (!request.pid || !request.port || !Number.isFinite(request.seconds)) {
      throw new Error('timer set requires --pid, --port, and --seconds.');
    }
    const ok = await confirm(options, `Set a ${formatDuration(request.seconds)} auto-close timer for PID ${request.pid} on port ${request.port}?`);
    if (!ok) {
      console.log('Cancelled.');
      return;
    }
    const result = await manager.createTimer(request);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.ok) {
      console.log(`Timer set: ${result.timer.id}`);
      console.log(`Due at: ${result.timer.dueAt}`);
      console.log('The desktop app or `greynoc-port-manager timer run-due` must be running to process due timers.');
    } else {
      throw new Error(result.error || 'Could not create timer.');
    }
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (subcommand === 'cancel' || subcommand === 'delete') {
    const id = args[2] || options.id;
    if (!id) throw new Error('timer cancel requires a timer id.');
    const result = manager.cancelTimer(String(id));
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.ok) {
      console.log(`Timer cancelled: ${result.timer.id}`);
    } else {
      throw new Error(result.error || 'Could not cancel timer.');
    }
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (subcommand === 'run-due' || subcommand === 'process-due') {
    await manager.processDueTimers();
    if (options.json) {
      console.log(JSON.stringify({ ok: true }, null, 2));
    } else {
      console.log('Due timers processed.');
    }
    return;
  }
  throw new Error(`Unknown timer command: ${subcommand}`);
}

async function main() {
  const parsed = parseArgv(process.argv.slice(2));
  const args = parsed._;
  const options = parsed.options;
  const command = args[0] || 'list';

  if (options.help || command === 'help') {
    printHelp();
    return;
  }
  if (options.version || command === 'version') {
    console.log(pkg.version);
    return;
  }
  if (command === 'list' || command === 'scan') {
    await commandList(options);
    return;
  }
  if (command === 'stop') {
    await commandStop(options);
    return;
  }
  if (command === 'timers') {
    printTimers(manager.listTimers(), options.json);
    return;
  }
  if (command === 'timer') {
    await commandTimer(args, options);
    return;
  }
  if (command === 'state-dir') {
    console.log(process.env.GREYNOC_STATE_DIR);
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
