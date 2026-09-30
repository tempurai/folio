import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, app, session } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { forwardSyncDone, registerIpcHandlers } from './ipc.js';
import { createSafeStorageCipher } from './secrets.js';
import { createServices } from './services.js';
import { MemoryWatcher } from './watch.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 零遥测：不调用 crashReporter.start()，不引入任何 analytics

let mainWindow: BrowserWindow | null = null;
let watcher: MemoryWatcher | null = null;

/** IPC sender 校验：dev 只认 vite dev server origin，prod 只认 file:// */
function isAllowedSender(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  if (!frame) return false;
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    try {
      return frame.origin === new URL(devUrl).origin;
    } catch {
      return false;
    }
  }
  // file:// 的 origin 在部分 Chromium 版本序列化为 'null'，退回按 URL 判断
  if (frame.origin === 'file://') return true;
  return frame.origin === 'null' && frame.url.startsWith('file://');
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1120,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    // Windows/Linux 的窗口与任务栏图标；macOS Dock 图标打包时由 icns 提供
    icon: join(__dirname, '../../../../assets/icons/icon-512.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      // 安全基线：四条显式写出，防回归
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  mainWindow = win;

  win.on('ready-to-show', () => win.show());
  win.on('closed', () => {
    mainWindow = null;
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

void app.whenReady().then(async () => {
  // 权限请求/校验一律默认拒绝（相机、麦克风、通知等全部不收）
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);

  // 导航收口：任何 webContents 不许跳走、不许开新窗口
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event) => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });

  const services = createServices({ cipher: createSafeStorageCipher() });
  watcher = new MemoryWatcher({
    home: services.paths.home,
    onSyncDone: forwardSyncDone(() => mainWindow),
    onError: (message) => console.error(message),
  });
  registerIpcHandlers({
    services,
    watcher,
    getWindow: () => mainWindow,
    isAllowedSender,
  });

  createWindow();

  // 恢复 watch 持久化状态
  if (services.getWatchStatus().enabled) {
    await watcher.start();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  void watcher?.stop();
});
