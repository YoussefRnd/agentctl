import { BrowserWindow } from 'electron';
import path from 'node:path';
import { reportDesktopPerformance } from '../performance';

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
  const windowStartedAt = performance.now();
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

  mainWindow.once('ready-to-show', () => {
    reportDesktopPerformance('desktop-window-create-to-ready', windowStartedAt);
    reportDesktopPerformance('desktop-process-to-window-ready');
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    const rendererUrl = new URL(process.env.ELECTRON_RENDERER_URL);
    if (process.env.AGENTCTL_PERF === '1') rendererUrl.searchParams.set('perf', '1');
    void mainWindow.loadURL(rendererUrl.toString());
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, '../renderer/index.html'),
      process.env.AGENTCTL_PERF === '1' ? { query: { perf: '1' } } : undefined,
    );
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
