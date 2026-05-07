const path = require('node:path');
const { app, BrowserWindow, Menu, shell, dialog, ipcMain, session } = require('electron');

let mainWindow = null;
let manager = null;

function createAppMenu() {
  const isMac = process.platform === 'darwin';
  const isDev = !app.isPackaged;
  const viewSubmenu = [
    ...(isDev ? [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' }
    ] : []),
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    { type: 'separator' },
    { role: 'togglefullscreen' }
  ];
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Refresh Ports',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            mainWindow?.webContents.send('ports:refresh-request');
          }
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: viewSubmenu
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About GreyNOC Port Manager',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About GreyNOC Port Manager',
              message: 'GreyNOC Port Manager',
              detail: 'Local-only desktop utility for detecting localhost and local dev servers, tracking time alive, and safely closing selected services now or on a timer.'
            });
          }
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpcHandlers() {
  const handle = (channel, fn) => {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        validateSender(event);
        return await fn(event, ...args);
      } catch (error) {
        return normalizeIpcError(error);
      }
    });
  };

  handle('ports:list', async () => {
    return manager.getLastScan();
  });

  handle('ports:getLatest', async () => {
    return manager.getLastScan();
  });

  handle('ports:refresh', async () => {
    return manager.refreshScan();
  });

  handle('timers:list', async () => {
    return { timers: manager.listTimers() };
  });

  handle('server:stop', async (_event, request) => {
    const result = await manager.stopServer(sanitizeRequest(request), 'manual');
    manager.refreshScan().catch(() => {});
    return result;
  });

  handle('timer:create', async (_event, request) => {
    return manager.createTimer(sanitizeRequest(request));
  });

  handle('timer:cancel', async (_event, timerId) => {
    return manager.cancelTimer(validateTimerId(timerId));
  });

  handle('dialog:confirm', async (_event, options) => {
    const safe = options && typeof options === 'object' ? options : {};
    const choice = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Cancel', 'Confirm'],
      defaultId: 0,
      cancelId: 0,
      title: capText(safe.title || 'Confirm', 80),
      message: capText(safe.message || 'Are you sure?', 180),
      detail: safe.detail ? capText(safe.detail, 1200) : undefined
    });
    return choice.response === 1;
  });
}

function validateSender(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error('Rejected IPC message from an unexpected sender.');
  }
}

function normalizeIpcError(error) {
  return {
    ok: false,
    status: 'failed',
    error: error && error.message ? error.message : 'IPC request failed.'
  };
}

function capText(value, maxLength) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, maxLength);
}

function toFiniteInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && Number.isInteger(n) ? n : undefined;
}

function validateTimerId(value) {
  if (typeof value !== 'string') return '';
  return /^[a-f0-9-]{1,64}$/i.test(value) ? value : '';
}

function sanitizeRequest(request) {
  if (!request || typeof request !== 'object') return {};
  const key = typeof request.key === 'string' && /^[0-9]{1,10}:[0-9]{1,5}$/.test(request.key)
    ? request.key
    : undefined;
  const commandLine = typeof request.commandLine === 'string'
    ? capText(request.commandLine, 4096)
    : undefined;
  const commandLineHash = typeof request.commandLineHash === 'string' && /^[a-f0-9]{64}$/i.test(request.commandLineHash)
    ? request.commandLineHash.toLowerCase()
    : undefined;
  const seconds = request.seconds !== undefined ? Number(request.seconds) : undefined;
  const pid = toFiniteInt(request.pid);
  const port = toFiniteInt(request.port);
  return {
    key,
    pid: pid && pid > 0 && pid <= 0xffffffff ? pid : undefined,
    port: port && port > 0 && port <= 65535 ? port : undefined,
    commandLine,
    commandLineHash,
    seconds: Number.isFinite(seconds) ? seconds : undefined
  };
}

function applyContentSecurityPolicy() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none';"
        ]
      }
    });
  });
}

function safeOpenExternal(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    return;
  }
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    shell.openExternal(parsed.toString());
  }
}

async function createWindow() {
  const isDev = !app.isPackaged;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1040,
    minHeight: 700,
    title: 'GreyNOC Port Manager',
    backgroundColor: '#0b1020',
    show: false,
    autoHideMenuBar: false,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      enableWebSQL: false,
      navigateOnDragDrop: false,
      devTools: isDev,
      spellcheck: false
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  await mainWindow.loadFile(path.join(__dirname, '..', 'public', 'index.html'));
}

async function boot() {
  app.setName('GreyNOC Port Manager');

  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (e) => e.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      safeOpenExternal(url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event, url) => {
      let parsed;
      try { parsed = new URL(url); } catch (_) {
        event.preventDefault();
        return;
      }
      if (parsed.protocol === 'file:') return;
      event.preventDefault();
      safeOpenExternal(url);
    });
    contents.on('will-redirect', (event, url) => {
      let parsed;
      try { parsed = new URL(url); } catch (_) {
        event.preventDefault();
        return;
      }
      if (parsed.protocol === 'file:') return;
      event.preventDefault();
    });
    contents.session.setPermissionRequestHandler((_wc, permission, callback) => {
      const allowed = new Set(['notifications']);
      callback(allowed.has(permission));
    });
  });

  await app.whenReady();

  process.env.GREYNOC_STATE_DIR = process.env.GREYNOC_STATE_DIR
    || path.join(app.getPath('userData'), 'state');

  manager = require('../lib/manager');

  applyContentSecurityPolicy();
  registerIpcHandlers();
  manager.onScanUpdated((data) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('ports:updated', data);
  });

  try {
    await manager.refreshScan();
  } catch (error) {
    console.error('Initial scan failed:', error.message);
  }
  manager.startBackgroundJobs();

  createAppMenu();
  await createWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
}

app.on('before-quit', () => {
  if (manager) manager.stopBackgroundJobs();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

boot().catch(async (error) => {
  await dialog.showMessageBox({
    type: 'error',
    title: 'GreyNOC Port Manager failed to launch',
    message: error.message
  });
  app.quit();
});
