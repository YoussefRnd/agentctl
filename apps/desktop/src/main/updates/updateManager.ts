import { app, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateState } from '../../shared/platform-types';
import { getMainWindow } from '../windows/mainWindow';

let updateState: UpdateState = { status: 'idle' };

export function getUpdateState(): UpdateState {
  return updateState;
}

function emitUpdateState(): void {
  getMainWindow()?.webContents.send('update:state', updateState);
}

export function setupAutoUpdater(): void {
  autoUpdater.autoDownload = true;

  autoUpdater.on('checking-for-update', () => {
    updateState = { status: 'checking' };
    emitUpdateState();
  });

  autoUpdater.on('update-available', (info) => {
    updateState = { status: 'available', version: info.version };
    emitUpdateState();
  });

  autoUpdater.on('update-not-available', () => {
    updateState = { status: 'up-to-date' };
    emitUpdateState();
  });

  autoUpdater.on('download-progress', (progress) => {
    if (updateState.status === 'downloaded') return;
    const version = 'version' in updateState ? updateState.version : '';
    updateState = {
      status: 'downloading',
      version,
      percent: progress.percent,
    };
    emitUpdateState();
  });

  autoUpdater.on('update-downloaded', (info) => {
    updateState = { status: 'downloaded', version: info.version };
    emitUpdateState();
  });

  autoUpdater.on('error', (err) => {
    updateState = { status: 'error', message: err instanceof Error ? err.message : String(err) };
    emitUpdateState();
  });

  if (app.isPackaged) {
    void autoUpdater.checkForUpdates().catch(() => undefined);
  }
}

export function registerUpdateIpc(): void {
  ipcMain.handle('update:get-state', () => updateState);

  ipcMain.on('update:check', () => {
    if (!app.isPackaged) {
      // Mock update state for development mode to avoid dev-updater.yml errors
      updateState = { status: 'checking' };
      emitUpdateState();
      setTimeout(() => {
        updateState = { status: 'up-to-date' };
        emitUpdateState();
      }, 1000);
      return;
    }
    void autoUpdater.checkForUpdates().catch(() => undefined);
  });

  ipcMain.on('update:install', () => {
    autoUpdater.quitAndInstall();
  });
}
