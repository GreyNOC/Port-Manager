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

const rawArgs = process.argv.slice(2);
let colorEnabled = shouldUseColor(rawArgs);

const ansi = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m'
};

function shouldUseColor(argv) {
  if (argv.includes('--json') || argv.includes('--no-color') || process.env.NO_COLOR) return false;
  if (argv.includes('--color') || process.env.FORCE_COLOR || process.env.GREYNOC_COLOR) return true;
  return Boolean(process.stdout.isTTY);
}

function color(style, value) {
  if (!colorEnabled) return String(value);
  return `${ansi[style] || ''}${value}${ansi.reset}`;
}

function bold(value) { return color('bold', value); }
function dim(value) { return color('dim', value); }
function cyan(value) { return color('cyan', value); }
function green(value) { return color('green', value); }
function yellow(value) { return color('yellow', value); }
function red(value) { return color('red', value); }
function gray(value) { return color('gray', value); }
function blue(value) { return color('blue', value); }
function magenta(value) { return color('magenta', value); }

function stripAnsi(value) {
  return String(value == null ? '' : value).replace(/\x1b\[[0-9;]*m/g, '');
}

function visibleLength(value) {
  return stripAnsi(value).length;
}

function line(char = '-', width = 84) {
  console.log(gray(char.repeat(width)));
}

function printHeader(title, subtitle) {
  const width = Math.min(96, Math.max(64, process.stdout.columns || 84));
  line('=', width);
  console.log(`${bold(cyan('GreyNOC'))} ${bold(title)} ${dim(`v${pkg.version}`)}`);
  if (subtitle) console.log(dim(subtitle));
  line('=', width);
}

function printSection(title) {
  console.log('');
  console.log(bold(cyan(title)));
}

function printSuccess(message) {
  console.log(`${green('[OK]')} ${message}`);
}

function printWarn(message) {
  console.error(`${yellow('[WARN]')} ${message}`);
}

function printError(message) {
  console.error(`${red('[ERR]')} ${message}`);
}

function commandPrefix() {
  if (process.env.GREYNOC_CLI_COMMAND) return process.env.GREYNOC_CLI_COMMAND;
  if (process.env.npm_lifecycle_event === 'cli') return 'npm run cli --';
  return 'GNP';
}

function printHelp() {
  const prefix = commandPrefix();
  printHeader('Port Manager CLI', 'Local port visibility, timers, and safe shutdown from your terminal.');
  console.log(`
${bold('Usage')}
  ${cyan(prefix)} ${green('<command>')} ${gray('[options]')}

${bold('Commands')}
  ${green('list, scan')}                 Scan and list local listening ports
  ${green('stop')}                       Stop a local server by PID and port
  ${green('timer list')}                 List timers
  ${green('timer set')}                  Set an auto-close timer for a PID and port
  ${green('timer cancel <id>')}          Cancel a pending timer
  ${green('timer run-due')}              Process timers that are due now
  ${green('state-dir')}                  Print the state directory

${bold('Options')}
  ${yellow('--json')}                     Print machine-readable JSON
  ${yellow('--scope <scope>')}            all, localhost, or local-network
  ${yellow('--filter <text>')}            Filter by process, port, label, address, or command
  ${yellow('--pid <pid>')}                Target process id
  ${yellow('--port <port>')}              Target port
  ${yellow('--key <key>')}                Target key from list output, usually pid:port
  ${yellow('--command-line <text>')}      Expected command-line snapshot for stop verification
  ${yellow('--seconds <seconds>')}        Timer duration in seconds
  ${yellow('--yes, -y')}                  Skip interactive confirmation
  ${yellow('--color / --no-color')}       Force or disable ANSI color
  ${yellow('--help, -h')}                 Show help
  ${yellow('--version, -v')}              Show version

${bold('Examples')}
  ${gray(`${prefix} list`)}
  ${gray(`${prefix} list --scope localhost --filter vite`)}
  ${gray(`${prefix} stop --pid 1234 --port 5173`)}
  ${gray(`${prefix} timer set --pid 1234 --port 5173 --seconds 300`)}

${bold('Most Used')}
  ${gray(`${prefix} stop --pid 1234 --port 5173`)}
  ${gray(`${prefix} timer set --pid 1234 --port 5173 --seconds 300`)}
  ${gray(`${prefix} timer list`)}
  ${gray(`${prefix} timer cancel <timer-id>`)}
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
    if (arg === '--color') {
      result.options.color = true;
      continue;
    }
    if (arg === '--no-color') {
      result.options['no-color'] = true;
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
  const text = String(value == null ? '' : value);
  const cleanLength = visibleLength(text);
  if (cleanLength >= width) return truncate(text, width);
  return text + ' '.repeat(width - cleanLength);
}

function truncate(value, width) {
  const text = String(value == null ? '' : value);
  if (visibleLength(text) <= width) return text;
  const clean = stripAnsi(text);
  if (width <= 1) return clean.slice(0, width);
  return `${clean.slice(0, width - 1)}~`;
}

function right(value, width) {
  const text = String(value == null ? '' : value);
  const cleanLength = visibleLength(text);
  if (cleanLength >= width) return truncate(text, width);
  return ' '.repeat(width - cleanLength) + text;
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

function formatClock(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

function formatScope(scope) {
  if (scope === 'localhost') return green('localhost');
  if (scope === 'local-network') return blue('network');
  return yellow(scope || 'unknown');
}

function statusBadge(server) {
  if (server.protected) return yellow('[protected]');
  if (server.ownedByCurrentUser === false) return yellow('[other user]');
  if (server.stopAllowed) return green('[stoppable]');
  return gray('[locked]');
}

function printSummary(data, servers) {
  const summary = data.summary || {};
  const total = Number.isFinite(Number(summary.active)) ? Number(summary.active) : servers.length;
  const cards = [
    ['shown', `${servers.length}/${total}`],
    ['localhost', servers.filter((server) => server.scope === 'localhost').length],
    ['network', servers.filter((server) => server.scope === 'local-network').length],
    ['timers', summary.timers || 0],
    ['scan', formatClock(data.scannedAt)]
  ];
  console.log(cards.map(([label, value]) => `${gray(label)} ${bold(value)}`).join(gray('  |  ')));
}

function printMostUsedCommands(servers) {
  const target = servers.find((server) => server.stopAllowed) || servers[0];
  const pid = target ? target.pid : '<pid>';
  const port = target ? target.port : '<port>';
  const prefix = commandPrefix();
  const commands = [
    ['close now', `${prefix} stop --pid ${pid} --port ${port}`],
    ['close in 5m', `${prefix} timer set --pid ${pid} --port ${port} --seconds 300`],
    ['timers', `${prefix} timer list`],
    ['cancel timer', `${prefix} timer cancel <timer-id>`],
    ['process due', `${prefix} timer run-due`],
    ['json', `${prefix} list --json`]
  ];

  printSection('Most Used Commands');
  for (const [label, command] of commands) {
    console.log(`  ${pad(gray(label), 12)} ${cyan(command)}`);
  }
}

function printServers(data, options) {
  const servers = filterServers(data.servers || [], options);
  if (options.json) {
    console.log(JSON.stringify({ ...data, servers }, null, 2));
    return;
  }
  printHeader('Port Scan', 'Listening localhost and local-network services.');
  printSummary(data, servers);
  printMostUsedCommands(servers);
  if (!servers.length) {
    console.log('');
    console.log(`${yellow('[EMPTY]')} No local listening ports found.`);
    return;
  }

  printSection(`${servers.length} Local Listening Port${servers.length === 1 ? '' : 's'}`);
  console.log(`${pad(gray('PORT'), 8)} ${pad(gray('PID'), 8)} ${pad(gray('SCOPE'), 10)} ${pad(gray('ALIVE'), 9)} ${pad(gray('STATUS'), 13)} ${pad(gray('PROCESS'), 20)} ${gray('LABEL')}`);
  console.log(gray('-'.repeat(96)));
  for (const server of servers) {
    console.log([
      pad(cyan(`:${server.port}`), 8),
      right(server.pid, 8),
      pad(formatScope(server.scope), 10),
      pad(formatDuration(server.aliveSeconds), 9),
      pad(statusBadge(server), 13),
      pad(server.processName, 20),
      bold(server.label || 'Local server')
    ].join(' '));
    const addresses = (server.addresses || []).join(', ') || '--';
    console.log(`  ${gray('key')} ${server.key}  ${gray('addr')} ${addresses}`);
    if (server.commandLine) {
      console.log(`  ${gray('cmd')} ${dim(truncate(server.commandLine, 110))}`);
    }
  }
  if (data.errors && data.errors.length) {
    printWarn(`Scanner warnings: ${data.errors.join(' | ')}`);
  }
}

function printTimers(timers, json) {
  if (json) {
    console.log(JSON.stringify({ timers }, null, 2));
    return;
  }
  printHeader('Timers', 'Auto-close timers for selected local services.');
  if (!timers.length) {
    console.log('');
    console.log(`${yellow('[EMPTY]')} No timers found.`);
    return;
  }
  console.log(`${pad(gray('STATUS'), 15)} ${pad(gray('DUE'), 24)} ${pad(gray('LEFT'), 10)} ${pad(gray('PORT'), 8)} ${pad(gray('PID'), 8)} ${gray('ID')}`);
  console.log(gray('-'.repeat(94)));
  for (const timer of timers) {
    const remainingSeconds = Math.max(0, Math.floor((Date.parse(timer.dueAt) - Date.now()) / 1000));
    const status = timer.status === 'pending' ? green(timer.status) : gray(timer.status);
    console.log([
      pad(status, 15),
      pad(timer.dueAt || '', 24),
      pad(timer.status === 'pending' ? formatDuration(remainingSeconds) : '--', 10),
      pad(cyan(`:${timer.port}`), 8),
      right(timer.pid, 8),
      timer.id
    ].join(' '));
    console.log(`  ${gray('target')} ${timer.processName || 'unknown'} ${gray('on')} ${timer.label || 'Local server'}`);
    if (timer.result) console.log(`  ${gray('result')} ${timer.result}`);
  }
}

async function confirm(options, message) {
  if (options.yes) return true;
  if (!process.stdin.isTTY) {
    throw new Error('Confirmation is required. Re-run with --yes to continue from a non-interactive shell.');
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${yellow('[CONFIRM]')} ${message} ${gray('Type yes to continue: ')}`);
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
    console.log(gray('Cancelled.'));
    return;
  }
  const result = await manager.stopServer(request, 'manual');
  await manager.refreshScan().catch(() => {});
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    printHeader('Stop Request', 'A SIGTERM request was sent after re-validating the selected process.');
    printSuccess(result.message);
    if (result.stopped) {
      console.log(`${gray('target')} ${cyan(`:${result.stopped.port}`)} ${gray('pid')} ${result.stopped.pid} ${gray('process')} ${result.stopped.processName}`);
    }
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
      console.log(gray('Cancelled.'));
      return;
    }
    const result = await manager.createTimer(request);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.ok) {
      printHeader('Timer Set', 'Auto-close timer saved for the selected local service.');
      printSuccess(`Timer set for ${cyan(`:${result.timer.port}`)} in ${bold(formatDuration(result.timer.seconds))}.`);
      console.log(`${gray('id')} ${result.timer.id}`);
      console.log(`${gray('due')} ${result.timer.dueAt}`);
      console.log(dim(`The desktop app or \`${commandPrefix()} timer run-due\` must be running to process due timers.`));
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
      printHeader('Timer Cancelled', 'Pending timer was marked cancelled.');
      printSuccess(result.timer.id);
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
      printHeader('Timer Sweep', 'Checked pending timers and processed anything due.');
      printSuccess('Due timers processed.');
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
    if (options.json) {
      console.log(JSON.stringify({ stateDir: process.env.GREYNOC_STATE_DIR }, null, 2));
    } else {
      printHeader('State Directory', 'Shared state used by the desktop app and CLI.');
      console.log(process.env.GREYNOC_STATE_DIR);
    }
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  printError(error.message);
  process.exitCode = 1;
});
