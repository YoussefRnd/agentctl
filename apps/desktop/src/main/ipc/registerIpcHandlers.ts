import { app, shell, type ipcMain } from 'electron';
import { ipcChannels } from '../../ipcChannels';
import { isExternalUrl } from '../windows/navigationPolicy';
import { createTrustedIpcScope } from './trustedIpc';
import { getServerPort, getServerSecret } from '../server/serverManager';
import { getMainWindow, rendererNavigationReady } from '../windows/mainWindow';
import { resolveWindowControls } from '../windowControls';
import { updateTrayStatus } from '../tray/trayManager';

function registerWindowIpcHandlers(on: typeof ipcMain.on, handle: typeof ipcMain.handle): void {
  on(ipcChannels.minimize, () => {
    getMainWindow()?.minimize();
  });

  on(ipcChannels.maximize, () => {
    const win = getMainWindow();
    if (!win) return;
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });

  on(ipcChannels.close, () => {
    getMainWindow()?.close();
  });

  handle(ipcChannels.isMaximized, () => {
    const win = getMainWindow();
    return win ? win.isMaximized() : false;
  });

  on(ipcChannels.openExternal, (_event, url: unknown) => {
    if (isExternalUrl(url)) void shell.openExternal(url).catch(() => undefined);
  });

  on(ipcChannels.toggleDevTools, () => {
    getMainWindow()?.webContents.toggleDevTools();
  });

  on(ipcChannels.reload, () => {
    getMainWindow()?.reload();
  });

  on(ipcChannels.toggleFullscreen, () => {
    const win = getMainWindow();
    if (win) win.setFullScreen(!win.isFullScreen());
  });

  on(ipcChannels.undo, () => {
    getMainWindow()?.webContents.undo();
  });
  on(ipcChannels.redo, () => {
    getMainWindow()?.webContents.redo();
  });
  on(ipcChannels.cut, () => {
    getMainWindow()?.webContents.cut();
  });
  on(ipcChannels.copy, () => {
    getMainWindow()?.webContents.copy();
  });
  on(ipcChannels.paste, () => {
    getMainWindow()?.webContents.paste();
  });
  on(ipcChannels.selectAll, () => {
    getMainWindow()?.webContents.selectAll();
  });

  on(ipcChannels.quit, () => {
    app.quit();
  });
}

export function registerIpcHandlers(): () => void {
  const { on, handle, dispose } = createTrustedIpcScope();
  on(ipcChannels.navigationReady, () => rendererNavigationReady());
  handle(ipcChannels.serverPort, () => getServerPort());
  handle(ipcChannels.serverSecret, () => getServerSecret());
  handle(ipcChannels.appVersion, () => app.getVersion());
  on(ipcChannels.updateTrayStatus, (_event, status: unknown) => {
    if (!status || typeof status !== 'object') return;
    const { runningCount, needsAttentionCount } = status as Record<string, unknown>;
    if (
      Number.isSafeInteger(runningCount) &&
      Number(runningCount) >= 0 &&
      Number.isSafeInteger(needsAttentionCount) &&
      Number(needsAttentionCount) >= 0
    ) {
      updateTrayStatus({
        runningCount: Number(runningCount),
        needsAttentionCount: Number(needsAttentionCount),
      });
    }
  });
  handle(ipcChannels.windowControls, () => resolveWindowControls(getMainWindow()));

  registerWindowIpcHandlers(on, handle);
  return dispose;
}
