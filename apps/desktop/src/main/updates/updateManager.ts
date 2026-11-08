import { app } from 'electron';
import { ipcChannels } from '../../ipcChannels';
import { autoUpdater } from 'electron-updater';
import type { UpdateState } from '@agentctl/shared';
import { createTrustedIpcScope } from '../ipc/trustedIpc';
import { getMainWindow } from '../windows/mainWindow';

let updateState: UpdateState = { status: 'idle' };

function emitUpdateState(): void {
  getMainWindow()?.webContents.send(ipcChannels.updateState, updateState);
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
  const { on, handle, dispose } = createTrustedIpcScope();
  handle(ipcChannels.getUpdateState, () => updateState);
  on(ipcChannels.checkForUpdate, () => {
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
  });
  on(ipcChannels.installUpdate, () => {
    if (updateState.status === 'downloaded') autoUpdater.quitAndInstall();
  });
  return () => {
    clearTimeout(timer);
    dispose();
  };
}
