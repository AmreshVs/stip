const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('stip', {
  getState: () => ipcRenderer.invoke('state'),
  act: (name, payload) => ipcRenderer.send('act', name, payload),
  onState: (cb) => ipcRenderer.on('state', (_event, state) => cb(state)),
  onShow: (cb) => ipcRenderer.on('show', (_event, data) => cb(data)),
});
