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

// 動態取得目前程式所在的資料夾 (支援打包成 .exe 後的相對路徑)
const WIN_ROOT_DIR = app.isPackaged ? path.dirname(process.execPath) : __dirname;
const MAC_ROOT_DIR = path.join(os.homedir(), 'Documents', 'CountdownTimer_Assets');

function getActiveRootDir() {
  return (currentOS === 'macos') ? MAC_ROOT_DIR : WIN_ROOT_DIR;
}

function ensureAssetDirs() {
  const rootDir = getActiveRootDir();
  const pngDir = path.join(rootDir, 'png_type');
  const soundDir = path.join(rootDir, 'sound_type');

  [pngDir, soundDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
    }
  });
}

function getFilesRecursively(dir, baseDir, validExts) {
  let results = [];
  if (!fs.existsSync(dir)) return results;

  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const dirent of list) {
    if (dirent.name.startsWith('.')) continue;
    const fullPath = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      results = results.concat(getFilesRecursively(fullPath, baseDir, validExts));
    } else {
      const ext = path.extname(dirent.name).toLowerCase();
      if (validExts.includes(ext)) {
        const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
        results.push(relPath);
      }
    }
  }
  return results;
}

function createWindow() {
  win = new BrowserWindow({
    width: 760,
    height: 560,
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
  ensureAssetDirs();
  createWindow();

  ipcMain.on('switch-os', (event, selectedOS) => {
    currentOS = selectedOS;
    ensureAssetDirs();
    win.webContents.send('os-changed', currentOS);
  });

  ipcMain.handle('get-current-os', () => currentOS);

  // 提供給前端索取根目錄路徑的 IPC 介面
  ipcMain.handle('get-root-dir', () => getActiveRootDir());

  ipcMain.on('toggle-always-on-top', (event, flag) => {
    if (win) {
      win.setAlwaysOnTop(flag, 'screen-saver');
      event.reply('always-on-top-status', win.isAlwaysOnTop());
    }
  });

  ipcMain.handle('open-asset-folder', async (event, subDir) => {
    const targetPath = path.join(getActiveRootDir(), subDir);
    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(targetPath, { recursive: true });
    }
    shell.openPath(targetPath);
  });

  ipcMain.handle('scan-assets', async (event, folderType) => {
    const targetDir = path.join(getActiveRootDir(), folderType);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
      return [];
    }
    const validExts = (folderType === 'png_type')
      ? ['.png', '.jpg', '.jpeg', '.gif']
      : ['.mp3', '.wav'];
    return getFilesRecursively(targetDir, targetDir, validExts);
  });

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
      win.setSize(targetView === 'hud-config' ? 440 : 760, targetView === 'hud-config' ? 760 : 560);
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
      win.setSize(780, 740);
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