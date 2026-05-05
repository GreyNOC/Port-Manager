const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('greynoc', {
  listPorts: () => ipcRenderer.invoke('ports:list'),
  listTimers: () => ipcRenderer.invoke('timers:list'),
  stopServer: (request) => ipcRenderer.invoke('server:stop', request),
  createTimer: (request) => ipcRenderer.invoke('timer:create', request),
  cancelTimer: (timerId) => ipcRenderer.invoke('timer:cancel', timerId),
  confirm: (options) => ipcRenderer.invoke('dialog:confirm', options),
  onRefreshRequest: (handler) => {
    if (typeof handler !== 'function') return () => {};
    const listener = () => { try { handler(); } catch (_) {} };
    ipcRenderer.on('ports:refresh-request', listener);
    return () => ipcRenderer.removeListener('ports:refresh-request', listener);
  }
});
