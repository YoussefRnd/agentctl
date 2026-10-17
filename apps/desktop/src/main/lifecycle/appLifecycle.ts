import { app, Menu, BrowserWindow } from 'electron';
import path from 'node:path';
import { getMainWindow, createMainWindow, handleDeepLink } from '../windows/mainWindow';

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

export function initAppLifecycle(stop: () => Promise<void>, isReady: () => boolean): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }

  if (process.platform === 'linux') {
    app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
  }

  const initialLink = process.argv.find((arg) => arg.startsWith(`${PROTOCOL}:`));
  if (initialLink) handleDeepLink(initialLink);

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
    if (!shutdownStarted && isReady() && BrowserWindow.getAllWindows().length === 0) {
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
    void stop()
      .catch((error: unknown) => {
        process.stderr.write(`Desktop shutdown failed: ${String(error)}\n`);
        process.exitCode = 1;
      })
      .finally(() => {
        shutdownComplete = true;
        app.quit();
      });
  });

  app.on('will-quit', () => {
    if (typeof process.exitCode === 'number' && process.exitCode !== 0) app.exit(process.exitCode);
  });

  process.once('SIGINT', () => app.quit());
  process.once('SIGTERM', () => app.quit());

  return true;
}
