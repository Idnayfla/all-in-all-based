const { contextBridge } = require('electron');

// Exposes a single flag so the web app can detect it is running inside the
// Electron main window and suppress UI elements handled natively (e.g. the
// GlobalCompanionBubble, which is replaced by the native bubble.html overlay).
contextBridge.exposeInMainWorld('__BASED_ELECTRON__', true);
