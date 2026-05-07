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

let managerInstance = null;
function getManager() {
  if (!managerInstance) managerInstance = require('../lib/manager');
  return managerInstance;
}
const pkg = require('../package.json');

const rawArgs = process.argv.slice(2);
let colorEnabled = shouldUseColor(rawArgs);
let shellMode = false;

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
  if (shellMode) return '';
  if (process.env.GREYNOC_CLI_COMMAND) return process.env.GREYNOC_CLI_COMMAND;
  if (process.env.npm_lifecycle_event === 'cli') return 'npm run cli --';
  return 'GNP';
}

function commandExample(command) {
  const prefix = commandPrefix();
  return prefix ? `${prefix} ${command}` : command;
}

function printHelp() {
  console.log(`${bold(cyan('GreyNOC'))} ${bold('Port Manager')} ${dim(`v${pkg.version}`)}`);
  console.log(`
${bold('Usage')}
  ${cyan(commandExample('<command>'))} ${gray('[target] [time] [options]')}

${bold('Commands')}
  ${green('list')}                       Show ports
  ${green('stop <port>')}                Stop a port
  ${green('timer <port> <time>')}        Set timer
  ${green('timers')}                     Show timers
  ${green('cancel <id>')}                Cancel timer
  ${green('run-due')}                    Process due timers
  ${green('state-dir')}                  Show state path

${bold('Options')}
  ${yellow('--json')}                     Print machine-readable JSON
  ${yellow('--scope <scope>')}            all, localhost, or local-network
  ${yellow('--filter <text>')}            Filter by process, port, label, address, or command
  ${yellow('--verbose')}                  Show address and command details
  ${yellow('--pid <pid>')}                Target process id
  ${yellow('--port <port>')}              Target port
  ${yellow('--key <key>')}                Target key, usually pid:port
  ${yellow('--command-line <text>')}      Expected command-line snapshot for stop verification
  ${yellow('--seconds <duration>')}       Timer duration, like 300, 5m, or 1h
  ${yellow('--yes, -y')}                  Skip interactive confirmation
  ${yellow('--color / --no-color')}       Force or disable ANSI color
  ${yellow('--help, -h')}                 Show help
  ${yellow('--version, -v')}              Show version

${bold('Examples')}
  ${gray(commandExample('list'))}
  ${gray(commandExample('stop 5173'))}
  ${gray(commandExample('timer 5173 5m'))}
  ${gray(commandExample('timer list'))}
  ${gray(commandExample('timer cancel <timer-id>'))}
`);
}

function splitCommandLine(input) {
  const args = [];
  let current = '';
  let quote = null;
  let escaped = false;

  for (const char of String(input || '')) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (escaped) current += '\\';
  if (quote) throw new Error(`Unclosed ${quote} quote.`);
  if (current) args.push(current);
  return args;
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

function parseDurationSeconds(value, label = 'Seconds') {
  const text = String(value == null ? '' : value).trim().toLowerCase();
  const match = text.match(/^(\d+(?:\.\d+)?)(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)?$/);
  if (!match) throw new Error(`${label} must be a duration like 300, 5m, or 1h.`);
  const amount = Number(match[1]);
  const unit = match[2] || 's';
  const scale = unit.startsWith('d') ? 86400
    : unit.startsWith('h') ? 3600
      : unit.startsWith('m') ? 60
        : 1;
  return amount * scale;
}

function applyTargetToken(request, token) {
  if (!token) return request;
  const text = String(token).trim();
  const keyMatch = text.match(/^(\d+):(\d+)$/);
  if (keyMatch) {
    request.pid = request.pid || toInt(keyMatch[1], 'PID');
    request.port = request.port || toInt(keyMatch[2], 'Port');
    request.key = request.key || text;
    return request;
  }
  const portMatch = text.match(/^:?(\d+)$/);
  if (portMatch) {
    request.port = request.port || toInt(portMatch[1], 'Port');
  }
  return request;
}

function buildRequest(options) {
  const request = {};
  if (options.pid !== undefined) request.pid = toInt(options.pid, 'PID');
  if (options.port !== undefined) request.port = toInt(options.port, 'Port');
  if (options.key !== undefined) request.key = String(options.key);
  if (options['command-line'] !== undefined) request.commandLine = String(options['command-line']);
  if (options.seconds !== undefined) request.seconds = parseDurationSeconds(options.seconds);
  return request;
}

async function resolveTarget(request) {
  if (request.pid && request.port) return request;
  if (!request.port) return request;

  const scan = await getManager().refreshScan();
  const matches = (scan.servers || []).filter((server) => server.port === request.port);
  if (matches.length === 1) {
    return {
      ...request,
      pid: matches[0].pid,
      key: matches[0].key
    };
  }
  const stoppable = matches.filter((server) => server.stopAllowed);
  if (stoppable.length === 1) {
    return {
      ...request,
      pid: stoppable[0].pid,
      key: stoppable[0].key
    };
  }
  if (matches.length > 1) {
    const choices = matches.map((server) => `${server.key} ${server.processName || 'process'}`).join(', ');
    throw new Error(`Port ${request.port} has multiple matches. Use pid:port. Matches: ${choices}`);
  }
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
    ['scan', formatClock(data.scannedAt)],
    ['strategy', data.strategyUsed || 'unknown'],
    ['ms', Number(data.durationMs || 0)]
  ];
  console.log(cards.map(([label, value]) => `${gray(label)} ${bold(value)}`).join(gray('  |  ')));
}

function printMostUsedCommands(servers) {
  const target = servers.find((server) => server.stopAllowed) || servers[0];
  const port = target ? target.port : '<port>';
  const targetToken = target ? String(target.port) : '<port>';
  const commands = [
    ['stop', commandExample(`stop ${targetToken}`)],
    ['5m', commandExample(`timer ${targetToken} 5m`)],
    ['timers', commandExample('timer list')],
    ['json', commandExample('list --json')],
    ['full target', commandExample(`stop ${target ? target.key : '<pid:port>'}`)]
  ];

  printSection('Quick Commands');
  for (const [label, command] of commands) {
    console.log(`  ${pad(gray(label), 11)} ${cyan(command)}`);
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
    if (options.verbose) {
      const addresses = (server.addresses || []).join(', ') || '--';
      console.log(`  ${gray('key')} ${server.key}  ${gray('addr')} ${addresses}`);
      if (server.commandLine) {
        console.log(`  ${gray('cmd')} ${dim(truncate(server.commandLine, 110))}`);
      }
    }
  }
  const warnings = [...(data.warnings || []), ...(data.errors || [])];
  if (warnings.length) {
    printWarn(`Scanner warnings: ${warnings.join(' | ')}`);
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
  const rl = options.readline || readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${yellow('[CONFIRM]')} ${message} ${gray('Type yes to continue: ')}`);
    return answer.trim().toLowerCase() === 'yes';
  } finally {
    if (!options.readline) rl.close();
  }
}

async function commandList(options) {
  const data = await getManager().refreshScan();
  printServers(data, options);
}

async function commandStop(options) {
  const request = await resolveTarget(applyTargetToken(buildRequest(options), options.target));
  if (!request.pid || !request.port) throw new Error('stop requires <port|pid:port>.');
  const ok = await confirm(options, `Stop PID ${request.pid} on port ${request.port}?`);
  if (!ok) {
    console.log(gray('Cancelled.'));
    return;
  }
  const manager = getManager();
  const result = await manager.stopServer(request, 'manual');
  manager.refreshScan().catch(() => {});
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    if (result.status === 'signal-sent-still-running' || result.status === 'already-closed') {
      printWarn(`${result.status}: ${result.message}`);
    } else {
      printSuccess(`${result.status || 'stopped'}: ${result.message}`);
    }
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
    printTimers(getManager().listTimers(), options.json);
    return;
  }
  if (subcommand === 'set' || subcommand === 'create') {
    const request = await resolveTarget(applyTargetToken(buildRequest(options), args[2] || options.target));
    if (args[3] !== undefined && request.seconds === undefined) request.seconds = parseDurationSeconds(args[3]);
    if (!request.pid || !request.port || !Number.isFinite(request.seconds)) {
      throw new Error('timer set requires <port|pid:port> and <time>.');
    }
    const ok = await confirm(options, `Set a ${formatDuration(request.seconds)} auto-close timer for PID ${request.pid} on port ${request.port}?`);
    if (!ok) {
      console.log(gray('Cancelled.'));
      return;
    }
    const result = await getManager().createTimer(request);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.ok) {
      printSuccess(`Timer ${result.timer.id} set for ${cyan(`:${result.timer.port}`)} in ${bold(formatDuration(result.timer.seconds))}.`);
    } else {
      throw new Error(result.error || 'Could not create timer.');
    }
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (/^:?\d+$/.test(subcommand) || /^\d+:\d+$/.test(subcommand)) {
    const request = await resolveTarget(applyTargetToken(buildRequest(options), subcommand));
    const duration = args[2] || options.seconds;
    if (duration !== undefined && request.seconds === undefined) request.seconds = parseDurationSeconds(duration);
    if (!request.pid || !request.port || !Number.isFinite(request.seconds)) {
      throw new Error('timer requires <port|pid:port> and <time>.');
    }
    const ok = await confirm(options, `Set a ${formatDuration(request.seconds)} auto-close timer for PID ${request.pid} on port ${request.port}?`);
    if (!ok) {
      console.log(gray('Cancelled.'));
      return;
    }
    const result = await getManager().createTimer(request);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.ok) {
      printSuccess(`Timer ${result.timer.id} set for ${cyan(`:${result.timer.port}`)} in ${bold(formatDuration(result.timer.seconds))}.`);
    } else {
      throw new Error(result.error || 'Could not create timer.');
    }
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (subcommand === 'cancel' || subcommand === 'delete') {
    const id = args[2] || options.id;
    if (!id) throw new Error('timer cancel requires a timer id.');
    const result = getManager().cancelTimer(String(id));
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.ok) {
      printSuccess(`Cancelled timer ${result.timer.id}.`);
    } else {
      throw new Error(result.error || 'Could not cancel timer.');
    }
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (subcommand === 'run-due' || subcommand === 'process-due') {
    await getManager().processDueTimers();
    if (options.json) {
      console.log(JSON.stringify({ ok: true }, null, 2));
    } else {
      printSuccess('Due timers processed.');
    }
    return;
  }
  throw new Error(`Unknown timer command: ${subcommand}`);
}

async function dispatch(argv, context = {}) {
  const parsed = parseArgv(argv);
  const args = parsed._;
  const options = { ...parsed.options };
  if (context.readline) options.readline = context.readline;
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
  if (command === 'stop' || command === 'close' || command === 'kill') {
    await commandStop({ ...options, target: args[1] });
    return;
  }
  if (command === 'timers') {
    printTimers(getManager().listTimers(), options.json);
    return;
  }
  if (command === 'timer') {
    await commandTimer(args, options);
    return;
  }
  if (command === 'cancel') {
    await commandTimer(['timer', 'cancel', args[1]], options);
    return;
  }
  if (command === 'run-due') {
    await commandTimer(['timer', 'run-due'], options);
    return;
  }
  if (command === 'in') {
    await commandTimer(['timer', args[2], args[1]], options);
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

async function runInteractiveShell() {
  shellMode = true;
  colorEnabled = shouldUseColor([]);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(`${bold(cyan('GreyNOC'))} ${bold('Port Manager')} ${dim(`v${pkg.version}`)}`);
  console.log(gray('Type help for commands, exit to quit.'));

  try {
    while (true) {
      const input = await rl.question(`${cyan('gnp>')} `);
      const trimmed = input.trim();
      if (!trimmed) continue;
      if (trimmed === 'exit' || trimmed === 'quit' || trimmed === 'q') break;
      try {
        const argv = splitCommandLine(trimmed);
        await dispatch(argv, { readline: rl });
        process.exitCode = 0;
      } catch (error) {
        printError(error.message);
      }
    }
  } finally {
    rl.close();
    shellMode = false;
  }
}

async function main(argv = process.argv.slice(2)) {
  const parsed = parseArgv(argv);
  const command = parsed._[0];
  if (((!command && process.stdin.isTTY) || command === 'shell' || command === 'interactive') && !parsed.options.json) {
    await runInteractiveShell();
    return;
  }
  await dispatch(argv);
}

if (require.main === module) {
  main().catch((error) => {
    printError(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgv,
  splitCommandLine,
  buildRequest,
  filterServers,
  shouldUseColor
};
