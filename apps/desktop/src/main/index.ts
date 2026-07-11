import { app, BrowserWindow, ipcMain, utilityProcess, Menu, Tray, nativeImage, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'node:path';
import fs from 'node:fs';
import { resolveWindowControls } from './windowControls';

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

function formatJsonLog(line: string): string {
  try {
    const parsed = JSON.parse(line) as {
      level?: number;
      time?: number;
      msg?: string;
      err?: { message?: string; stack?: string };
      [key: string]: unknown;
    };

    if (typeof parsed.level === 'number' && parsed.msg) {
      let levelLabel = 'INFO';
      let color = '\x1b[32m'; // Green
      if (parsed.level === 20) {
        levelLabel = 'DEBUG';
        color = '\x1b[36m'; // Cyan
      } else if (parsed.level === 40) {
        levelLabel = 'WARN';
        color = '\x1b[33m'; // Yellow
      } else if (parsed.level >= 50) {
        levelLabel = 'ERROR';
        color = '\x1b[31m'; // Red
      }

      const reset = '\x1b[0m';
      const timeStr = parsed.time ? new Date(parsed.time).toLocaleTimeString() : '';
      const timePart = timeStr ? `[${timeStr}] ` : '';

      let logLine = `${timePart}${color}${levelLabel}${reset}: ${parsed.msg}`;

      // Extract all extra keys (like req, res, responseTime) to print them
      const extra = { ...parsed };
      delete extra.level;
      delete extra.time;
      delete extra.msg;
      delete extra.err;

      if (Object.keys(extra).length > 0) {
        const extraLines = JSON.stringify(extra, null, 2)
          .split('\n')
          .map((l) => `    ${l}`)
          .join('\n');
        logLine += `\n${extraLines}\n`;
      } else {
        logLine += '\n';
      }

      if (parsed.err) {
        if (parsed.err.message) {
          logLine += `  ${color}Error:${reset} ${parsed.err.message}\n`;
        }
        if (parsed.err.stack) {
          logLine += `  ${parsed.err.stack}\n`;
        }
      }
      return logLine;
    }
  } catch {
    // not JSON
  }
  return line + '\n';
}

// ─── Server Lifecycle ───────────────────────────────────────────────
function startServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    const serverEntry = path.join(__dirname, 'server-process.js');
    serverProcess = utilityProcess.fork(serverEntry, [], { stdio: 'pipe' });

    let stdoutBuffer = '';
    serverProcess.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) {
          process.stdout.write(formatJsonLog(line));
        }
      }
    });

    let stderrBuffer = '';
    serverProcess.stderr?.on('data', (chunk: Buffer) => {
      stderrBuffer += chunk.toString();
      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) {
          process.stderr.write(formatJsonLog(line));
        }
      }
    });

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
  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    title: 'AgentCtl',
    ...(isMac
      ? {
          titleBarStyle: 'hidden' as const,
          trafficLightPosition: { x: 16, y: 18 },
        }
      : {
          frame: false,
        }),
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

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('win:maximized-changed', true);
  });

  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('win:maximized-changed', false);
  });
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
          } else {
            createWindow();
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
      } else {
        createWindow();
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

// Registered at module load so the renderer can query it the moment it
// connects, regardless of whenReady() timing / dev restarts.
ipcMain.handle('win:get-controls', () => resolveWindowControls(mainWindow));

function registerWindowIpcHandlers() {
  ipcMain.on('win:minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.on('win:maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipcMain.on('win:close', () => {
    mainWindow?.close();
  });

  ipcMain.handle('win:is-maximized', () => {
    return mainWindow ? mainWindow.isMaximized() : false;
  });

  ipcMain.on('win:open-external', (_event, url: string) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:') {
        void shell.openExternal(url);
      }
    } catch {
      // ignore invalid URLs
    }
  });

  ipcMain.on('win:toggle-devtools', () => {
    mainWindow?.webContents.toggleDevTools();
  });

  ipcMain.on('win:reload', () => {
    mainWindow?.reload();
  });

  ipcMain.on('win:toggle-fullscreen', () => {
    if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen());
  });

  ipcMain.on('edit:undo', () => {
    mainWindow?.webContents.undo();
  });
  ipcMain.on('edit:redo', () => {
    mainWindow?.webContents.redo();
  });
  ipcMain.on('edit:cut', () => {
    mainWindow?.webContents.cut();
  });
  ipcMain.on('edit:copy', () => {
    mainWindow?.webContents.copy();
  });
  ipcMain.on('edit:paste', () => {
    mainWindow?.webContents.paste();
  });
  ipcMain.on('edit:select-all', () => {
    mainWindow?.webContents.selectAll();
  });

  const ZOOM_STEP = 0.5;
  const ZOOM_MIN = -3;
  const ZOOM_MAX = 3;
  ipcMain.on('view:zoom-in', () => {
    if (!mainWindow) return;
    const next = Math.min(ZOOM_MAX, mainWindow.webContents.getZoomLevel() + ZOOM_STEP);
    mainWindow.webContents.setZoomLevel(next);
  });
  ipcMain.on('view:zoom-out', () => {
    if (!mainWindow) return;
    const next = Math.max(ZOOM_MIN, mainWindow.webContents.getZoomLevel() - ZOOM_STEP);
    mainWindow.webContents.setZoomLevel(next);
  });
  ipcMain.on('view:zoom-reset', () => {
    mainWindow?.webContents.setZoomLevel(0);
  });

  ipcMain.on('app:quit', () => {
    app.quit();
  });
}

// ─── Auto Updater ────────────────────────────────────────────────────
type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; version: string }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'downloaded'; version: string }
  | { status: 'up-to-date' }
  | { status: 'error'; message: string };

let updateState: UpdateState = { status: 'idle' };

function emitUpdateState() {
  mainWindow?.webContents.send('update:state', updateState);
}

function setupAutoUpdater() {
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

function registerUpdateIpc() {
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

// ─── App Lifecycle ───────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  if (process.platform === 'linux') {
    app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
  }

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
    registerWindowIpcHandlers();
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
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { role: 'resetZoom' },
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

    try {
      serverPort = await startServer();
      process.stdout.write(`Server started on port ${serverPort.toString()}\n`);
    } catch (err) {
      process.stderr.write(`Failed to start server: ${String(err)}\n`);
      app.quit();
      return;
    }

    createWindow();
    createTray();

    // Auto-updater — listeners always active; initial check only in production builds
    registerUpdateIpc();
    setupAutoUpdater();

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
