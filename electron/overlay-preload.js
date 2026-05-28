const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  hideCompanion: () => ipcRenderer.send('companion:hide'),
  hideForCapture: () => ipcRenderer.send('companion:hide-for-capture'),
  showAfterCapture: () => ipcRenderer.send('companion:show-after-capture'),
  // Captures the screen entirely in the main process via desktopCapturer.
  // Returns a data:image/jpeg;base64,... string or null on failure.
  captureScreenMain: () => ipcRenderer.invoke('companion:capture-screen'),
  // Notify the bubble window that Based started or stopped speaking.
  // Pass the spoken text when starting so the bubble can display it.
  setSpeaking: (speaking, text) => ipcRenderer.send('companion:speaking', speaking, text ?? ''),
});
