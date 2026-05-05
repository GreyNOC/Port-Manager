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
