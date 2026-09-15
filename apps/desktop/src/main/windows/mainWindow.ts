import { BrowserWindow } from 'electron';
import path from 'node:path';

let mainWindow: BrowserWindow | null = null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function handleDeepLink(url: string): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  try {
    const parsed = new URL(url);
    if (parsed.pathname === '/sessions' || parsed.pathname.startsWith('/sessions/')) {
      mainWindow.webContents.send('deep-link', url);
    }
  } catch {
    // Ignore invalid deep link URL
  }
}

export function createMainWindow(): BrowserWindow {
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

  return mainWindow;
}
