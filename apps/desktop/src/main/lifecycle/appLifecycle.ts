import { app, Menu, BrowserWindow } from 'electron';
import path from 'node:path';
import { getMainWindow, createMainWindow, handleDeepLink } from '../windows/mainWindow';
import { stopServer } from '../server/serverManager';
import { destroyTray } from '../tray/trayManager';

export const PROTOCOL = 'agentctl';

export function setupApplicationMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [];
  if (process.platform === 'darwin') {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }
  template.push(
    {
      label: 'File',
      submenu: [{ role: 'close' }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }],
    },
  );
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

export function initAppLifecycle(): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }

  if (process.platform === 'linux') {
    app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
  }

  // Handle second-instance (deep links on Windows/Linux)
  app.on('second-instance', (_event, argv) => {
    const deeplink = argv.find((a) => a.startsWith(`${PROTOCOL}:`));
    if (deeplink) handleDeepLink(deeplink);

    const win = getMainWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  // macOS: register deep link protocol before app is ready
  if (!app.isPackaged) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
      path.resolve(process.argv[1] ?? ''),
    ]);
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL);
  }

  // macOS: handle open-url event
  app.on('will-finish-launching', () => {
    app.on('open-url', (event, url) => {
      event.preventDefault();
      handleDeepLink(url);
    });
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  let shutdownStarted = false;
  let shutdownComplete = false;
  app.on('before-quit', (event) => {
    if (shutdownComplete) return;
    event.preventDefault();
    if (shutdownStarted) return;
    shutdownStarted = true;
    destroyTray();
    void stopServer().finally(() => {
      shutdownComplete = true;
      app.quit();
    });
  });

  process.once('SIGINT', () => app.quit());
  process.once('SIGTERM', () => app.quit());

  return true;
}
