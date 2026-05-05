#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const cliPath = path.join(projectRoot, 'bin', 'greynoc-port-manager.js');
const commandNames = ['GNP', 'greynoc-port-manager', 'greynoc-ports'];

function windowsShim(name) {
  return [
    '@echo off',
    'setlocal',
    `node "${cliPath}" %*`,
    ''
  ].join('\r\n');
}

function posixShim() {
  return [
    '#!/usr/bin/env sh',
    `exec node "${cliPath}" "$@"`,
    ''
  ].join('\n');
}

function targetDirectory() {
  if (process.env.GREYNOC_CLI_SHIM_DIR) {
    return process.env.GREYNOC_CLI_SHIM_DIR;
  }
  if (process.platform === 'win32') {
    return process.env.npm_config_prefix || path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'npm');
  }
  return path.join(process.env.npm_config_prefix || path.join(os.homedir(), '.local'), 'bin');
}

function ensureCliExists() {
  if (!fs.existsSync(cliPath)) {
    throw new Error(`CLI entrypoint not found: ${cliPath}`);
  }
}

function install() {
  ensureCliExists();
  const outDir = targetDirectory();
  fs.mkdirSync(outDir, { recursive: true });
  for (const name of commandNames) {
    if (process.platform === 'win32') {
      fs.writeFileSync(path.join(outDir, `${name}.cmd`), windowsShim(name));
    } else {
      const outPath = path.join(outDir, name);
      fs.writeFileSync(outPath, posixShim());
      fs.chmodSync(outPath, 0o755);
    }
  }
  console.log(`Installed GreyNOC Port Manager CLI shims to ${outDir}`);
  if (process.platform === 'win32') {
    console.log('Open a new terminal if GNP is still not recognized in the current session.');
  }
}

try {
  install();
} catch (error) {
  console.error(`[ERR] ${error.message}`);
  process.exitCode = 1;
}
