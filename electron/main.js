const { app, BrowserWindow, shell, Menu, globalShortcut, ipcMain, screen, session, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');

// Disable Chromium's autoplay restriction so TTS audio plays without a prior
// user gesture — required for the auto-greeting in the companion overlay.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Suppress Chromium internal ERROR-level logs (level 3 = FATAL only).
// The Web Speech API produces "chunked_data_pipe_upload_data_stream.cc OnSizeReceived
// failed with Error: -2" on every recognition session teardown. These are written
// directly by Chromium's C++ network process at the OS fd level — Node's
// process.stderr.write cannot intercept them. This flag is the correct layer.
app.commandLine.appendSwitch('log-level', '3');

// Google API key for Web Speech API — Electron ships without Chrome's embedded key,
// so onresult never fires. This key grants access to the Speech Recognition endpoint.
// Falls back gracefully (wake word stays disabled) if the key is absent.
if (process.env.GOOGLE_API_KEY) {
  console.log('[based] Google API key loaded:', process.env.GOOGLE_API_KEY.slice(0, 8) + '...');
  app.commandLine.appendSwitch('google-api-key', process.env.GOOGLE_API_KEY);
} else {
  console.log('[based] No GOOGLE_API_KEY found — Web Speech will fail');
}

const IS_DEV = process.env.ELECTRON_DEV === 'true';
const APP_URL = IS_DEV ? 'http://localhost:3000' : 'https://www.getbased.dev';
const OVERLAY_URL = IS_DEV ? 'http://localhost:3000/companion' : 'https://www.getbased.dev/companion';

let win = null;
let overlayWin = null;
let bubbleWin = null;
let isQuitting = false;

const BUBBLE_POS_FILE = () => path.join(app.getPath('userData'), 'bubble-position.json');

// Button is 52px wide/tall, centered in 320px window, 18px margin-bottom, 530px from top.
// Allow window X/Y to go negative so the button can reach all screen edges.
const BUBBLE_WIN_W = 320;
const BUBBLE_WIN_H = 600;
const BUBBLE_BTN_LEFT = (BUBBLE_WIN_W - 52) / 2;          // 134 — px from window left to button left
const BUBBLE_BTN_OFFSET = BUBBLE_WIN_H - 52 - 18;         // 530 — px from window top to button top
const BUBBLE_MIN_X = -BUBBLE_BTN_LEFT;                    // window X when button is at screen left
const BUBBLE_MAX_X_OFFSET = BUBBLE_WIN_W - BUBBLE_BTN_LEFT; // 186 — px from window left to button right
const BUBBLE_MIN_Y = -BUBBLE_BTN_OFFSET;                  // window Y when button is at screen top

function loadBubblePosition(defaultX, defaultY) {
  try {
    const data = JSON.parse(fs.readFileSync(BUBBLE_POS_FILE(), 'utf8'));
    if (typeof data.x === 'number' && typeof data.y === 'number') {
      const { workAreaSize } = screen.getPrimaryDisplay();
      // Validate saved position fits the current window size — reset if off-screen
      const fitsX = data.x >= BUBBLE_MIN_X && data.x + BUBBLE_MAX_X_OFFSET <= workAreaSize.width;
      const fitsY = data.y >= BUBBLE_MIN_Y && data.y + BUBBLE_WIN_H <= workAreaSize.height;
      if (fitsX && fitsY) return { x: data.x, y: data.y };
    }
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

// --- Screen-wide cursor polling for bubble pupil tracking ---
let cursorPollInterval = null;

function startCursorPoll() {
  if (cursorPollInterval) return;
  cursorPollInterval = setInterval(() => {
    if (!bubbleWin || bubbleWin.isDestroyed()) {
      stopCursorPoll();
      return;
    }
    const pos = screen.getCursorScreenPoint();
    bubbleWin.webContents.send('cursor-pos', pos);
  }, 33); // ~30fps
}

function stopCursorPoll() {
  if (cursorPollInterval) {
    clearInterval(cursorPollInterval);
    cursorPollInterval = null;
  }
}

function createBubbleWindow() {
  const { workAreaSize } = screen.getPrimaryDisplay();
  // Window is 320×600 (transparent). The 52px button sits at the bottom-centre.
  // Default position keeps the button at the bottom-right corner of the work area.
  const defaultX = workAreaSize.width - 250;
  const defaultY = workAreaSize.height - (BUBBLE_WIN_H + 16);
  const pos = loadBubblePosition(defaultX, defaultY);
  bubbleWin = new BrowserWindow({
    width: 320,
    height: 600,
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
  bubbleWin.once('ready-to-show', () => {
    bubbleWin.setAlwaysOnTop(true, 'screen-saver');
    bubbleWin.show();
    // Transparent pixels should not eat OS mouse events — only the button area
    // needs to be interactive. The renderer will toggle this on hover.
    bubbleWin.setIgnoreMouseEvents(true, { forward: true });
    // Begin polling the OS cursor position and forwarding to the renderer
    startCursorPoll();
  });
  bubbleWin.on('moved', saveBubblePosition);
  bubbleWin.on('close', e => {
    if (!isQuitting) e.preventDefault();
  });
  bubbleWin.on('closed', () => {
    stopCursorPoll();
  });
}

function toggleOverlay() {
  if (!overlayWin) return;
  if (overlayWin.isVisible()) {
    overlayWin.hide();
    bubbleWin?.webContents.send('companion-bubble:state', 'closed');
  } else {
    overlayWin.setAlwaysOnTop(true, 'screen-saver');
    overlayWin.show();
    overlayWin.moveTop();
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

  // Grant microphone + media permissions so Web Speech API (Hey Based wake word)
  // works without a browser permission prompt. Without this handler, Electron 20+
  // denies all permission requests by default on named partitions like persist:based.
  const grantMediaPermission = (_webContents, permission, callback) => {
    const micPerms = ['media', 'microphone', 'audioCapture', 'audio-capture'];
    callback(micPerms.includes(permission));
  };
  const checkMediaPermission = (_webContents, permission) => {
    const micPerms = ['media', 'microphone', 'audioCapture', 'audio-capture'];
    return micPerms.includes(permission);
  };
  session.defaultSession.setPermissionRequestHandler(grantMediaPermission);
  session.defaultSession.setPermissionCheckHandler(checkMediaPermission);
  basedSession.setPermissionRequestHandler(grantMediaPermission);
  basedSession.setPermissionCheckHandler(checkMediaPermission);

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
    // Restore bubble's knowledge that companion is open again
    bubbleWin?.webContents.send('companion-bubble:state', 'open');
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

  // Captured once at drag start — used as the stable right-edge anchor for the whole drag.
  let resizeRightEdge = null;

  ipcMain.on('companion:resize-start', () => {
    if (!overlayWin) return;
    const [w, ] = overlayWin.getSize();
    const [x, ] = overlayWin.getPosition();
    resizeRightEdge = x + w;
  });

  ipcMain.on('companion:set-width', (_, panelWidth) => {
    if (!overlayWin) return;
    // Lazy-init: if resize-start wasn't processed yet, capture now (first call, window hasn't moved)
    if (resizeRightEdge === null) {
      const [w] = overlayWin.getSize();
      const [x] = overlayWin.getPosition();
      resizeRightEdge = x + w;
    }
    const winWidth = Math.round(Math.max(300, Math.min(620, panelWidth + 20)));
    const [, winHeight] = overlayWin.getSize();
    const [, currentY] = overlayWin.getPosition();
    const newX = Math.max(0, resizeRightEdge - winWidth);
    // setBounds is atomic — no frame where size and position are out of sync
    overlayWin.setBounds({ x: newX, y: currentY, width: winWidth, height: winHeight });
  });

  ipcMain.on('companion:resize-end', () => {
    resizeRightEdge = null;
  });

  // Bubble renderer toggles OS-level mouse passthrough based on hover position
  ipcMain.on('bubble:ignore-mouse', (_, ignore) => {
    bubbleWin?.setIgnoreMouseEvents(ignore, { forward: true });
  });

  let savePosTimer = null;
  ipcMain.on('companion-bubble:move-delta', (_, dx, dy) => {
    if (!bubbleWin) return;
    const [x, y] = bubbleWin.getPosition();
    const { workAreaSize } = screen.getPrimaryDisplay();
    const newX = Math.max(BUBBLE_MIN_X, Math.min(x + dx, workAreaSize.width - BUBBLE_MAX_X_OFFSET));
    const newY = Math.max(BUBBLE_MIN_Y, Math.min(y + dy, workAreaSize.height - BUBBLE_WIN_H));
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
