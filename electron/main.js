const { app, BrowserWindow, shell, Menu, globalShortcut, ipcMain, screen, session, desktopCapturer } = require('electron');
const path = require('path');

const APP_URL = 'https://getbased.dev';
const OVERLAY_URL = 'https://getbased.dev/companion';

let win = null;
let overlayWin = null;
let bubbleWin = null;
let isQuitting = false;

function createOverlayWindow() {
  const { workAreaSize } = screen.getPrimaryDisplay();

  overlayWin = new BrowserWindow({
    width: 380,
    height: 580,
    x: workAreaSize.width - 400,
    y: workAreaSize.height - 600,
    alwaysOnTop: true,
    frame: false,
    transparent: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'persist:based',
      preload: path.join(__dirname, 'overlay-preload.js'),
    },
  });

  overlayWin.loadURL(OVERLAY_URL);

  overlayWin.on('close', e => {
    if (!isQuitting) {
      e.preventDefault();
      overlayWin.hide();
    }
  });
}

function createBubbleWindow() {
  const { workAreaSize } = screen.getPrimaryDisplay();
  bubbleWin = new BrowserWindow({
    width: 88,
    height: 88,
    x: workAreaSize.width - 104,
    y: workAreaSize.height - 104,
    alwaysOnTop: true,
    frame: false,
    transparent: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'persist:based',
      preload: path.join(__dirname, 'bubble-preload.js'),
    },
  });
  bubbleWin.loadFile(path.join(__dirname, 'bubble.html'));
  bubbleWin.once('ready-to-show', () => bubbleWin.show());
  bubbleWin.on('close', e => {
    if (!isQuitting) e.preventDefault();
  });
}

function toggleOverlay() {
  if (!overlayWin) return;
  if (overlayWin.isVisible()) {
    overlayWin.hide();
    bubbleWin?.webContents.send('companion-bubble:state', 'closed');
  } else {
    overlayWin.show();
    overlayWin.focus();
    bubbleWin?.webContents.send('companion-bubble:state', 'open');
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0a0a0f',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    icon: path.join(__dirname, '../public/icon-512.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'persist:based',
    },
    show: false,
  });

  win.once('ready-to-show', () => win.show());

  // Open external links in the system browser, not in the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // When main window closes, destroy the overlay so the app can fully quit
  win.on('closed', () => {
    if (overlayWin) {
      overlayWin.destroy();
      overlayWin = null;
    }
    if (bubbleWin) {
      bubbleWin.destroy();
      bubbleWin = null;
    }
  });

  win.loadURL(APP_URL);
  Menu.setApplicationMenu(null);
}

app.whenReady().then(async () => {
  // ── Fix: strip any cached www.getbased.dev → getbased.dev 301 redirects ──
  // Electron/Chromium caches permanent (301) redirects indefinitely. If the
  // persist:based session ever received a www→apex 301 it will replay it on
  // every subsequent request, creating an ERR_TOO_MANY_REDIRECTS loop when
  // Vercel then redirects www back to apex.
  // Clear the cache once on startup to flush stale redirect entries, then
  // intercept any future www navigations and rewrite them to the apex domain.
  const basedSession = session.fromPartition('persist:based');
  await basedSession.clearCache();

  // Belt-and-suspenders: rewrite www.getbased.dev → getbased.dev at the
  // network layer so the loop can never happen even if the cache refills.
  const wwwFilter = { urls: ['https://www.getbased.dev/*'] };
  basedSession.webRequest.onBeforeRequest(wwwFilter, ({ url }, callback) => {
    callback({ redirectURL: url.replace('https://www.getbased.dev', 'https://getbased.dev') });
  });
  session.defaultSession.webRequest.onBeforeRequest(wwwFilter, ({ url }, callback) => {
    callback({ redirectURL: url.replace('https://www.getbased.dev', 'https://getbased.dev') });
  });

  createWindow();
  createOverlayWindow();
  createBubbleWindow();

  // Allow getDisplayMedia / screen capture in all sessions (default + named partition).
  // Registered AFTER windows are created so the 'persist:based' session object is fully
  // initialised with its webContents — avoids the handler being lost on first launch.
  const grantScreenCapture = (_request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then(sources => callback({ video: sources[0] }))
      .catch(() => callback({}));
  };
  session.defaultSession.setDisplayMediaRequestHandler(grantScreenCapture);
  session.fromPartition('persist:based').setDisplayMediaRequestHandler(grantScreenCapture);

  // Ctrl+Shift+Space (Win/Linux) / Cmd+Shift+Space (Mac) toggles the overlay
  globalShortcut.register('CommandOrControl+Shift+Space', toggleOverlay);

  ipcMain.on('companion:hide', () => {
    overlayWin?.hide();
    bubbleWin?.webContents.send('companion-bubble:state', 'closed');
  });
  ipcMain.on('companion:hide-for-capture', () => {
    win?.hide();
    overlayWin?.hide();
    bubbleWin?.hide();
  });
  ipcMain.on('companion:show-after-capture', () => {
    win?.show();
    overlayWin?.show();
    bubbleWin?.show();
  });

  // Screen capture entirely in the main process — avoids the buffered-video-frame
  // timing issue that occurs when getDisplayMedia is called from the renderer.
  // desktopCapturer.getSources() takes a fresh snapshot at call time, so the
  // 300 ms settle delay after hiding is sufficient.
  ipcMain.handle('companion:capture-screen', async () => {
    try {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height } = primaryDisplay.size;
      const maxW = 1280;
      const thumbW = Math.min(width, maxW);
      const thumbH = Math.round((height * thumbW) / width);

      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: thumbW, height: thumbH },
      });

      if (!sources.length) return null;
      const nativeImg = sources[0].thumbnail;
      const jpegBuf = nativeImg.toJPEG(75);
      return 'data:image/jpeg;base64,' + jpegBuf.toString('base64');
    } catch {
      return null;
    }
  });
  ipcMain.on('companion-bubble:click', () => toggleOverlay());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
