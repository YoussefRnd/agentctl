import { app, BrowserWindow, ipcMain, utilityProcess, Menu, Tray, nativeImage, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'node:path';
import fs from 'node:fs';

interface ReadyMessage {
  type: 'ready';
  port: number;
  secret: string;
}

let mainWindow: BrowserWindow | null = null;
let serverProcess: Electron.UtilityProcess | null = null;
let serverPort = 0;
let serverSecret = '';
let tray: Tray | null = null;

// ─── Deep Link Protocol ────────────────────────────────────────────
const PROTOCOL = 'agentctl';

function handleDeepLink(url: string) {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  const parsed = new URL(url);
  if (parsed.pathname === '/sessions' || parsed.pathname.startsWith('/sessions/')) {
    mainWindow.webContents.send('deep-link', url);
  }
}

// ─── Server Lifecycle ───────────────────────────────────────────────
function startServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    const serverEntry = path.join(__dirname, 'server-process.js');
    serverProcess = utilityProcess.fork(serverEntry);

    const timeout = setTimeout(() => {
      reject(new Error('Server failed to start within 15 seconds'));
    }, 15_000);

    serverProcess.on('message', (msg: unknown) => {
      const isReadyMsg = (m: unknown): m is ReadyMessage => {
        return (
          typeof m === 'object' &&
          m !== null &&
          'type' in m &&
          (m as Record<string, unknown>).type === 'ready' &&
          'port' in m &&
          typeof (m as Record<string, unknown>).port === 'number'
        );
      };

      if (isReadyMsg(msg)) {
        clearTimeout(timeout);
        serverPort = msg.port;
        serverSecret = msg.secret;
        resolve(msg.port);
      }
    });

    serverProcess.on('exit', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`Server process exited with code ${code.toString()}`));
      }
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    title: 'AgentCtl',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── App Menu ────────────────────────────────────────────────────────
function buildAppMenu() {
  const isMac = process.platform === 'darwin';

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow?.webContents.send('navigate', '/settings'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
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
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
              { type: 'separator' as const },
              { role: 'window' as const },
            ]
          : [{ role: 'close' as const }]),
      ],
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'AgentCtl on GitHub',
          click: () => {
            void shell.openExternal('https://github.com/YoussefRnd/agentctl');
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ─── System Tray ─────────────────────────────────────────────────────
function createTrayIcon(): Electron.NativeImage {
  const iconPath = path.join(__dirname, '../../resources/tray-icon.png');
  if (fs.existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath);
  }
  // Fallback: 16x16 solid-color PNG data URL
  return nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMklEQVQ4T2NkYPj/n4EBBJgYKAEMFAMMFAEMFAMMFAEMFAMMFAEMFAMMFAEMFAMMFAAMFAMADP0L/wQnGGQAAAAASUVORK5CYII='
  );
}

function createTray() {
  try {
    const icon = createTrayIcon();
    tray = new Tray(icon);
    tray.setToolTip('AgentCtl');

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show Window',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          app.quit();
        },
      },
    ]);

    tray.setContextMenu(contextMenu);

    tray.on('double-click', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  } catch {
    // Tray not supported on this platform — skip gracefully
  }
}

// ─── IPC Handlers ────────────────────────────────────────────────────
function registerIpcHandlers() {
  ipcMain.handle('server:get-port', () => serverPort);
  ipcMain.handle('server:get-secret', () => serverSecret);
  ipcMain.handle('app:get-version', () => app.getVersion());
}

// ─── App Lifecycle ───────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Handle second-instance (deep links on Windows/Linux)
  app.on('second-instance', (_event, argv) => {
    const deeplink = argv.find((a) => a.startsWith(`${PROTOCOL}:`));
    if (deeplink) handleDeepLink(deeplink);

    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
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

  void app.whenReady().then(async () => {
    registerIpcHandlers();

    try {
      serverPort = await startServer();
      // eslint-disable-next-line no-console
      console.log(`Server started on port ${serverPort.toString()}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to start server:', err);
      app.quit();
      return;
    }

    buildAppMenu();
    createWindow();
    createTray();

    // Auto-updater — only in production builds
    if (app.isPackaged) {
      autoUpdater.checkForUpdatesAndNotify().catch(() => {
        // Silent fail — updates are optional
      });
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('will-quit', () => {
    tray?.destroy();
    tray = null;
    serverProcess?.kill();
  });
}
