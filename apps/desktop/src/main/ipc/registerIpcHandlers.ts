import { app, ipcMain, shell } from 'electron';
import { isExternalUrl } from '../windows/navigationPolicy';
import { isTrustedSender } from './sender';
import { getServerPort, getServerSecret } from '../server/serverManager';
import { getMainWindow, rendererNavigationReady } from '../windows/mainWindow';
import { resolveWindowControls } from '../windowControls';
import { updateTrayStatus } from '../tray/trayManager';

function registerWindowIpcHandlers(on: typeof ipcMain.on, handle: typeof ipcMain.handle): void {
  on('win:minimize', () => {
    getMainWindow()?.minimize();
  });

  on('win:maximize', () => {
    const win = getMainWindow();
    if (!win) return;
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });

  on('win:close', () => {
    getMainWindow()?.close();
  });

  handle('win:is-maximized', () => {
    const win = getMainWindow();
    return win ? win.isMaximized() : false;
  });

  on('win:open-external', (_event, url: unknown) => {
    if (isExternalUrl(url)) void shell.openExternal(url).catch(() => undefined);
  });

  on('win:toggle-devtools', () => {
    getMainWindow()?.webContents.toggleDevTools();
  });

  on('win:reload', () => {
    getMainWindow()?.reload();
  });

  on('win:toggle-fullscreen', () => {
    const win = getMainWindow();
    if (win) win.setFullScreen(!win.isFullScreen());
  });

  on('edit:undo', () => {
    getMainWindow()?.webContents.undo();
  });
  on('edit:redo', () => {
    getMainWindow()?.webContents.redo();
  });
  on('edit:cut', () => {
    getMainWindow()?.webContents.cut();
  });
  on('edit:copy', () => {
    getMainWindow()?.webContents.copy();
  });
  on('edit:paste', () => {
    getMainWindow()?.webContents.paste();
  });
  on('edit:select-all', () => {
    getMainWindow()?.webContents.selectAll();
  });

  on('app:quit', () => {
    app.quit();
  });
}

export function registerIpcHandlers(): () => void {
  const disposers: (() => void)[] = [];
  const on: typeof ipcMain.on = (channel, listener) => {
    const guarded: typeof listener = (event, ...args) => {
      if (isTrustedSender(event)) listener(event, ...args);
    };
    ipcMain.on(channel, guarded);
    disposers.push(() => {
      ipcMain.removeListener(channel, guarded);
    });
    return ipcMain;
  };
  const handle: typeof ipcMain.handle = (channel, listener) => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!isTrustedSender(event)) throw new Error('Unauthorized IPC sender');
      return listener(event, ...args);
    });
    disposers.push(() => {
      ipcMain.removeHandler(channel);
    });
  };
  on('navigation:ready', () => rendererNavigationReady());
  handle('server:get-port', () => getServerPort());
  handle('server:get-secret', () => getServerSecret());
  handle('app:get-version', () => app.getVersion());
  on('tray:update-status', (_event, status: unknown) => {
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
  handle('win:get-controls', () => resolveWindowControls(getMainWindow()));

  registerWindowIpcHandlers(on, handle);
  return () => {
    for (const dispose of disposers.splice(0).reverse()) dispose();
  };
}
