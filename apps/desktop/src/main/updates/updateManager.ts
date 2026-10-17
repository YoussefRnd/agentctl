import { app, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateState } from '@agentctl/shared';
import { isTrustedSender } from '../ipc/sender';
import { getMainWindow } from '../windows/mainWindow';

let updateState: UpdateState = { status: 'idle' };

export function getUpdateState(): UpdateState {
  return updateState;
}

function emitUpdateState(): void {
  getMainWindow()?.webContents.send('update:state', updateState);
}

export function setupAutoUpdater(): () => void {
  const subscriptions: (() => void)[] = [];
  const on: typeof autoUpdater.on = (event, listener) => {
    autoUpdater.on(event, listener);
    subscriptions.push(() => {
      autoUpdater.removeListener(event, listener);
    });
    return autoUpdater;
  };
  autoUpdater.autoDownload = true;

  on('checking-for-update', () => {
    updateState = { status: 'checking' };
    emitUpdateState();
  });

  on('update-available', (info) => {
    updateState = { status: 'available', version: info.version };
    emitUpdateState();
  });

  on('update-not-available', () => {
    updateState = { status: 'up-to-date' };
    emitUpdateState();
  });

  on('download-progress', (progress) => {
    if (updateState.status === 'downloaded') return;
    const version = 'version' in updateState ? updateState.version : '';
    updateState = {
      status: 'downloading',
      version,
      percent: progress.percent,
    };
    emitUpdateState();
  });

  on('update-downloaded', (info) => {
    updateState = { status: 'downloaded', version: info.version };
    emitUpdateState();
  });

  on('error', (err) => {
    updateState = { status: 'error', message: err instanceof Error ? err.message : String(err) };
    emitUpdateState();
  });

  if (app.isPackaged) {
    void autoUpdater.checkForUpdates().catch(() => undefined);
  }
  return () => {
    for (const dispose of subscriptions.splice(0)) dispose();
  };
}

export function registerUpdateIpc(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  ipcMain.handle('update:get-state', (event) => {
    if (!isTrustedSender(event)) throw new Error('Unauthorized IPC sender');
    return updateState;
  });

  const check = (event: Electron.IpcMainEvent) => {
    if (!isTrustedSender(event)) return;
    if (!app.isPackaged) {
      // Mock update state for development mode to avoid dev-updater.yml errors
      updateState = { status: 'checking' };
      emitUpdateState();
      clearTimeout(timer);
      timer = setTimeout(() => {
        updateState = { status: 'up-to-date' };
        emitUpdateState();
      }, 1000);
      return;
    }
    void autoUpdater.checkForUpdates().catch(() => undefined);
  };
  const install = (event: Electron.IpcMainEvent) => {
    if (isTrustedSender(event) && updateState.status === 'downloaded') autoUpdater.quitAndInstall();
  };
  ipcMain.on('update:check', check);
  ipcMain.on('update:install', install);
  return () => {
    clearTimeout(timer);
    ipcMain.removeHandler('update:get-state');
    ipcMain.removeListener('update:check', check);
    ipcMain.removeListener('update:install', install);
  };
}
