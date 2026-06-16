const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  hideCompanion: () => ipcRenderer.send('companion:hide'),
  showCompanion: () => ipcRenderer.send('companion:show'),
  hideForCapture: () => ipcRenderer.send('companion:hide-for-capture'),
  showAfterCapture: () => ipcRenderer.send('companion:show-after-capture'),
  // Captures the screen entirely in the main process via desktopCapturer.
  // Returns a data:image/jpeg;base64,... string or null on failure.
  captureScreenMain: () => ipcRenderer.invoke('companion:capture-screen'),
  // Notify the bubble window that Based started or stopped speaking.
  // Pass the spoken text (already the progressive slice) so the bubble can display it directly.
  setSpeaking: (speaking, text) => ipcRenderer.send('companion:speaking', speaking, text ?? ''),
  resizeStart: () => ipcRenderer.send('companion:resize-start'),
  setCompanionWidth: (width) => ipcRenderer.send('companion:set-width', width),
  resizeEnd: () => ipcRenderer.send('companion:resize-end'),
  onProactiveTrigger: (cb) => ipcRenderer.on('proactive-trigger', (_event, data) => cb(data)),
  // System control
  openUrl: (url) => ipcRenderer.invoke('system:open-url', url),
  launchApp: (appName) => ipcRenderer.invoke('system:launch-app', appName),
  typeText: (text, target) => ipcRenderer.invoke('system:type-text', text, target),
  clipboardRead: () => ipcRenderer.invoke('system:clipboard-read'),
  clipboardWrite: (text) => ipcRenderer.invoke('system:clipboard-write', text),
  getVolume: () => ipcRenderer.invoke('system:get-volume'),
  setVolume: (level) => ipcRenderer.invoke('system:set-volume', level),
  getActiveApp: () => ipcRenderer.invoke('system:get-active-app'),
});
