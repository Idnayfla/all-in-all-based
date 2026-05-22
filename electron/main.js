const { app, BrowserWindow, shell, Menu, globalShortcut, ipcMain, screen, session } = require('electron');
const path = require('path');

const APP_URL = 'https://getbased.dev';
const OVERLAY_URL = 'https://getbased.dev/companion';
const BUBBLE_URL = 'https://getbased.dev/companion-bubble';

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
  bubbleWin.loadURL(BUBBLE_URL);
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
  const win = new BrowserWindow({
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

app.whenReady().then(() => {
  // Allow getDisplayMedia / screen capture in renderer windows
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    callback({ video: { mandatory: { chromeMediaSource: 'screen' } } });
  });

  createWindow();
  createOverlayWindow();
  createBubbleWindow();

  // Ctrl+Shift+Space (Win/Linux) / Cmd+Shift+Space (Mac) toggles the overlay
  globalShortcut.register('CommandOrControl+Shift+Space', toggleOverlay);

  ipcMain.on('companion:hide', () => {
    overlayWin?.hide();
    bubbleWin?.webContents.send('companion-bubble:state', 'closed');
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
