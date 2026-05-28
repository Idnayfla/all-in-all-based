const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bubbleAPI', {
  toggle: () => ipcRenderer.send('companion-bubble:click'),
  moveDelta: (dx, dy) => ipcRenderer.send('companion-bubble:move-delta', dx, dy),
  onStateChange: cb => {
    ipcRenderer.on('companion-bubble:state', (_event, state) => cb(state));
  },
  onSpeaking: cb => {
    ipcRenderer.on('companion-bubble:speaking', (_event, speaking, text, msPerWord) => cb(speaking, text ?? '', msPerWord ?? 0));
  },
});
