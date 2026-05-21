const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  hideCompanion: () => ipcRenderer.send('companion:hide'),
});
