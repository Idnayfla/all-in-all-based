const { app, BrowserWindow, shell, Menu, globalShortcut, ipcMain, screen, session, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_URL = 'https://www.getbased.dev';
const OVERLAY_URL = 'https://www.getbased.dev/companion';

let win = null;
let overlayWin = null;
let bubbleWin = null;
let isQuitting = false;

const BUBBLE_POS_FILE = () => path.join(app.getPath('userData'), 'bubble-position.json');

function loadBubblePosition(defaultX, defaultY) {
  try {
    const data = JSON.parse(fs.readFileSync(BUBBLE_POS_FILE(), 'utf8'));
    if (typeof data.x === 'number' && typeof data.y === 'number') return { x: data.x, y: data.y };
  } catch {}
  return { x: defaultX, y: defaultY };
}

function saveBubblePosition() {
  if (!bubbleWin) return;
  const [x, y] = bubbleWin.getPosition();
  try { fs.writeFileSync(BUBBLE_POS_FILE(), JSON.stringify({ x, y })); } catch {}
}

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
  // Window is 290×380 (transparent). The 52px button sits at the bottom-centre.
  // Default position keeps the button at the bottom-right corner of the work area.
  const defaultX = workAreaSize.width - 230;
  const defaultY = workAreaSize.height - 396;
  const pos = loadBubblePosition(defaultX, defaultY);
  bubbleWin = new BrowserWindow({
    width: 290,
    height: 380,
    x: pos.x,
    y: pos.y,
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
  bubbleWin.on('moved', saveBubblePosition);
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
      preload: path.join(__dirname, 'main-preload.js'),
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
  // Set a Chrome-like User-Agent on the persist:based session before any window
  // loads a URL. Electron's default UA contains "Electron/x.x.x" which Vercel's
  // bot-protection layer blocks with a 403. Spoofing a standard Chrome UA prevents
  // that while keeping all session cookies and auth tokens intact.
  const CHROME_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  const basedSession = session.fromPartition('persist:based');
  basedSession.setUserAgent(CHROME_UA);

  // Clear cached 301/302 redirects once on startup so stale www. ↔ apex
  // redirect chains never accumulate. Does not wipe cookies or auth tokens.
  await basedSession.clearCache();

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
  let mainWinWasVisible = false;
  ipcMain.on('companion:hide-for-capture', () => {
    mainWinWasVisible = win?.isVisible() ?? false;
    if (mainWinWasVisible) win?.hide();
    overlayWin?.hide();
    bubbleWin?.hide();
  });
  ipcMain.on('companion:show-after-capture', () => {
    if (mainWinWasVisible) win?.show();
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

  // Forward speaking state and progressive text slice from overlay to bubble window
  ipcMain.on('companion:speaking', (_, speaking, text) => {
    bubbleWin?.webContents.send('companion-bubble:speaking', speaking, text ?? '');
  });

  let savePosTimer = null;
  ipcMain.on('companion-bubble:move-delta', (_, dx, dy) => {
    if (!bubbleWin) return;
    const [x, y] = bubbleWin.getPosition();
    const { workAreaSize } = screen.getPrimaryDisplay();
    const newX = Math.max(0, Math.min(x + dx, workAreaSize.width - 290));
    const newY = Math.max(0, Math.min(y + dy, workAreaSize.height - 380));
    bubbleWin.setPosition(newX, newY);
    if (savePosTimer) clearTimeout(savePosTimer);
    savePosTimer = setTimeout(saveBubblePosition, 500);
  });

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
