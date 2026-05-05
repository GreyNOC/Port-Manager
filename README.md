# GreyNOC Port Manager

GreyNOC Port Manager is a standalone desktop utility for developers who work with localhost dev servers.

It detects active localhost and local-network development servers, tracks how long each one has been alive, highlights newly detected servers, and lets you safely stop selected local services immediately or on a timer.

## Architecture

This is an Electron desktop app. The renderer talks to the main process over IPC only — there is no embedded HTTP server, no listening port, and no network surface. Process scanning and termination run in the main process; the renderer is sandboxed.

- `electron/main.js` — main process, IPC handlers, window/menu setup.
- `electron/preload.js` — context-bridged IPC API exposed to the renderer.
- `lib/scanner.js` — platform port scanner (lsof / ss / netstat / PowerShell).
- `lib/state.js` — JSON-on-disk state for first-seen times and timers.
- `lib/manager.js` — refresh/stop/timer business logic invoked over IPC.
- `public/index.html`, `public/app.js`, `public/styles.css` — renderer UI.

## Safety model

- The app never opens a network port. Renderer ↔ main communication uses Electron IPC.
- The renderer is sandboxed (`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`) and runs under a strict Content-Security-Policy.
- The UI requires manual confirmation (native dialog) before stopping a selected process.
- Stop and timer operations re-scan and verify the same PID + port (and optional command-line snapshot) before terminating.
- Protected/system PIDs are blocked.
- Processes not owned by the current user are blocked when ownership can be detected.
- State is stored in the OS user-data directory with restrictive file permissions.

## Requirements

- Node.js 18 or newer (only for `npm install` and packaging — end users of a built installer don't need Node)
- Platform scanner tools:
  - macOS / Linux: `lsof` is preferred; Linux can also use `ss` or `netstat`
  - Windows: PowerShell (`Get-NetTCPConnection`)

## Install dependencies

```bash
npm install
```

## Run the desktop app

```bash
npm start
```

On Windows you can also double-click `run-electron.bat`. The launcher checks for Node.js / npm, installs dependencies if `node_modules` is missing, then starts the app.

## Use the CLI

The app also ships a dependency-free Node CLI that uses the same scanner, state, stop checks, and timer logic as the desktop app.

From this source checkout:

```bash
npm run cli -- list
npm run cli -- list --json
npm run cli -- stop --pid 1234 --port 5173
npm run cli -- timer set --pid 1234 --port 5173 --seconds 300
npm run cli -- timer list
npm run cli -- timer cancel <timer-id>
```

After global install or package bin linking, the same commands are available as:

```bash
greynoc-port-manager list
greynoc-ports list
```

Stop and timer commands ask for confirmation in interactive shells. Use `--yes` for automation after you have verified the PID and port from `list`.

The CLI shares the desktop state directory by default:

- Windows: `%APPDATA%\GreyNOC Port Manager\state`
- macOS: `~/Library/Application Support/GreyNOC Port Manager/state`
- Linux: `$XDG_CONFIG_HOME/GreyNOC Port Manager/state` or `~/.config/GreyNOC Port Manager/state`

You can override it with `GREYNOC_STATE_DIR=...`.

Timers are processed while the desktop app is running. For terminal-only workflows, run `greynoc-port-manager timer run-due` from a scheduler to process timers that are already due.

## Build desktop installers

```bash
npm run dist
```

Output goes to `release/`. For a quick unpacked build:

```bash
npm run dist:dir
```

## Useful environment variables

```bash
GREYNOC_SCAN_INTERVAL_MS=3000    # background scan interval, default 3000
GREYNOC_STATE_DIR=...            # override state directory (default: app userData/state)
```

## Project layout

```text
greynoc-port-manager/
├── electron/
│   ├── main.js
│   └── preload.js
├── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── lib/
│   ├── scanner.js
│   ├── state.js
│   └── manager.js
├── assets/
│   ├── icon.svg
│   └── icon.png
├── package.json
└── README.md
```

## Check source syntax

```bash
npm run check
```
"# Port-Manager" 
