const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  hideCompanion: () => ipcRenderer.send('companion:hide'),
  hideForCapture: () => ipcRenderer.send('companion:hide-for-capture'),
  showAfterCapture: () => ipcRenderer.send('companion:show-after-capture'),
});
