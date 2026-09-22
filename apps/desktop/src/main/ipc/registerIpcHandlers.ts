import { app, ipcMain, shell } from 'electron';
import type { TrayStatus } from '../../shared/platform-types';
import { getServerPort, getServerSecret } from '../server/serverManager';
import { getMainWindow } from '../windows/mainWindow';
import { resolveWindowControls } from '../windowControls';
import { updateTrayStatus } from '../tray/trayManager';

export function registerWindowIpcHandlers(): void {
  ipcMain.on('win:minimize', () => {
    getMainWindow()?.minimize();
  });

  ipcMain.on('win:maximize', () => {
    const win = getMainWindow();
    if (!win) return;
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });

  ipcMain.on('win:close', () => {
    getMainWindow()?.close();
  });

  ipcMain.handle('win:is-maximized', () => {
    const win = getMainWindow();
    return win ? win.isMaximized() : false;
  });

  ipcMain.on('win:open-external', (_event, url: string) => {
    try {
      const parsed = new URL(url);
      if (
        parsed.protocol === 'http:' ||
        parsed.protocol === 'https:' ||
        parsed.protocol === 'mailto:'
      ) {
        void shell.openExternal(url);
      }
    } catch {
      // ignore invalid URLs
    }
  });

  ipcMain.on('win:toggle-devtools', () => {
    getMainWindow()?.webContents.toggleDevTools();
  });

  ipcMain.on('win:reload', () => {
    getMainWindow()?.reload();
  });

  ipcMain.on('win:toggle-fullscreen', () => {
    const win = getMainWindow();
    if (win) win.setFullScreen(!win.isFullScreen());
  });

  ipcMain.on('edit:undo', () => {
    getMainWindow()?.webContents.undo();
  });
  ipcMain.on('edit:redo', () => {
    getMainWindow()?.webContents.redo();
  });
  ipcMain.on('edit:cut', () => {
    getMainWindow()?.webContents.cut();
  });
  ipcMain.on('edit:copy', () => {
    getMainWindow()?.webContents.copy();
  });
  ipcMain.on('edit:paste', () => {
    getMainWindow()?.webContents.paste();
  });
  ipcMain.on('edit:select-all', () => {
    getMainWindow()?.webContents.selectAll();
  });

  ipcMain.on('app:quit', () => {
    app.quit();
  });
}

export function registerIpcHandlers(): void {
  ipcMain.handle('server:get-port', () => getServerPort());
  ipcMain.handle('server:get-secret', (event) => {
    if (
      event.sender !== getMainWindow()?.webContents ||
      event.senderFrame !== event.sender.mainFrame
    ) {
      throw new Error('Unauthorized IPC sender');
    }
    return getServerSecret();
  });
  ipcMain.handle('app:get-version', () => app.getVersion());
  ipcMain.on('tray:update-status', (_event, status: TrayStatus) => {
    updateTrayStatus(status);
  });
  ipcMain.handle('win:get-controls', () => resolveWindowControls(getMainWindow()));

  registerWindowIpcHandlers();
}
