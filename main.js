const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { uIOhook } = require('uiohook-napi');
const path = require('path');
const os = require('os');
const fs = require('fs');

let win;
let currentMode = 'main';
let lastFloatingPos = [50, 50];
let lastFloatingSize = [320, 110];
let savedFloatingOpacity = 1.0;

let currentOS = (process.platform === 'darwin') ? 'macos' : 'windows';

const WIN_ASSET_DIR = "D:\\m6232set\\Desktop\\軟體安裝檔\\Countdown_Timer_plus_v1.4.1\\Countdown_Timer_plus_v1.4.1\\png_type";
const MAC_ASSET_DIR = path.join(os.homedir(), 'Documents', 'CountdownTimer_Assets', 'png_type');

function getActiveAssetDir() {
  return (currentOS === 'macos') ? MAC_ASSET_DIR : WIN_ASSET_DIR;
}

function ensureAssetDir() {
  const target = getActiveAssetDir();
  if (!fs.existsSync(target)) {
    try { fs.mkdirSync(target, { recursive: true }); } catch (e) {}
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 740,
    height: 540,
    minWidth: 400,
    minHeight: 250,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    hasShadow: false,
    resizable: true,
    titleBarStyle: (currentOS === 'macos') ? 'hidden' : 'default',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  win.loadFile('index.html');
}

app.whenReady().then(() => {
  ensureAssetDir();
  createWindow();

  ipcMain.on('switch-os', (event, selectedOS) => {
    currentOS = selectedOS;
    ensureAssetDir();
    win.webContents.send('os-changed', currentOS);
  });

  ipcMain.handle('get-current-os', () => currentOS);

  ipcMain.on('switch-view', (event, targetView) => {
    if (targetView === 'main' || targetView === 'profiles' || targetView === 'hud-config') {
      if (currentMode === 'floating') {
        lastFloatingPos = win.getPosition();
        lastFloatingSize = win.getSize();
      }
      currentMode = targetView;
      win.setResizable(true);
      win.setIgnoreMouseEvents(false);
      win.setOpacity(1.0);
      win.setMinimumSize(420, 480);
      win.setSize(targetView === 'hud-config' ? 440 : 740, targetView === 'hud-config' ? 760 : 540);
      win.center();
    } else if (targetView === 'edit') {
      if (currentMode === 'floating') {
        lastFloatingPos = win.getPosition();
        lastFloatingSize = win.getSize();
      }
      currentMode = 'edit';
      win.setResizable(true);
      win.setIgnoreMouseEvents(false);
      win.setOpacity(1.0);
      win.setMinimumSize(680, 520);
      win.setSize(760, 720);
      win.center();
    } else if (targetView === 'floating') {
      currentMode = 'floating';
      win.setResizable(false);
      win.setIgnoreMouseEvents(false);
      win.setOpacity(savedFloatingOpacity);
      win.setSize(lastFloatingSize[0], lastFloatingSize[1]);
      win.setPosition(lastFloatingPos[0], lastFloatingPos[1]);
    }
    win.webContents.send('mode-changed', currentMode);
  });

  ipcMain.on('set-hud-bounds', (event, bounds) => {
    if (bounds.opacity !== undefined) {
      savedFloatingOpacity = parseFloat(bounds.opacity);
      if (currentMode === 'floating') win.setOpacity(savedFloatingOpacity);
    }
    if (bounds.x !== undefined && bounds.y !== undefined) {
      lastFloatingPos = [parseInt(bounds.x), parseInt(bounds.y)];
      if (currentMode === 'floating') win.setPosition(lastFloatingPos[0], lastFloatingPos[1]);
    }
  });

  ipcMain.handle('get-hud-pos', () => {
    if (currentMode === 'floating') return win.getPosition();
    return lastFloatingPos;
  });

  ipcMain.handle('select-file', async (event, filters) => {
    const assetDir = getActiveAssetDir();
    const res = await dialog.showOpenDialog(win, {
      defaultPath: fs.existsSync(assetDir) ? assetDir : undefined,
      properties: ['openFile'],
      filters: filters
    });
    if (!res.canceled && res.filePaths.length > 0) {
      return path.basename(res.filePaths[0]);
    }
    return null;
  });

  ipcMain.handle('export-profile-file', async (event, dataStr, defaultName) => {
    const res = await dialog.showSaveDialog(win, {
      title: '匯出設定檔',
      defaultPath: `${defaultName}.json`,
      filters: [{ name: 'JSON Files', extensions: ['json'] }]
    });
    if (!res.canceled && res.filePath) {
      fs.writeFileSync(res.filePath, dataStr, 'utf-8');
      return true;
    }
    return false;
  });

  ipcMain.handle('import-profile-file', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: '匯入設定檔',
      properties: ['openFile'],
      filters: [{ name: 'JSON Files', extensions: ['json'] }]
    });
    if (!res.canceled && res.filePaths.length > 0) {
      const content = fs.readFileSync(res.filePaths[0], 'utf-8');
      return JSON.parse(content);
    }
    return null;
  });

  try {
    uIOhook.on('keydown', (e) => {
      win.webContents.send('global-keydown', {
        keycode: e.keycode,
        rawcode: e.rawcode,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey
      });
    });
    uIOhook.start();
  } catch (err) {
    console.warn("全域鍵盤監聽初始化失敗:", err);
  }
});

app.on('window-all-closed', () => {
  try { uIOhook.stop(); } catch(e) {}
  if (process.platform !== 'darwin') app.quit();
});