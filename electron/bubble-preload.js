const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bubbleAPI', {
  toggle: () => ipcRenderer.send('companion-bubble:click'),
  onStateChange: cb => {
    ipcRenderer.on('companion-bubble:state', (_event, state) => cb(state));
  },
});
