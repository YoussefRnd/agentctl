import { app, BrowserWindow, shell } from 'electron';
import { isExternalUrl, isRendererNavigation } from './navigationPolicy';
import path from 'node:path';
import { reportDesktopPerformance } from '../performance';

let mainWindow: BrowserWindow | null = null;
let pendingDeepLink: string | null = null;
let rendererReady = false;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function handleDeepLink(url: string): void {
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol === 'agentctl:' &&
      (parsed.pathname === '/sessions' || parsed.pathname.startsWith('/sessions/'))
    ) {
      if (!mainWindow || !rendererReady) {
        pendingDeepLink = url;
        return;
      }
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      mainWindow.webContents.send('deep-link', url);
    }
  } catch {
    // Ignore invalid deep link URL
  }
}

export function rendererNavigationReady(): void {
  rendererReady = true;
  if (pendingDeepLink) {
    const url = pendingDeepLink;
    pendingDeepLink = null;
    handleDeepLink(url);
  }
}

export function createMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  rendererReady = false;
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

  const contents = mainWindow.webContents;
  contents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) void shell.openExternal(url).catch(() => undefined);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (isRendererNavigation(url, contents.getURL())) return;
    event.preventDefault();
    if (isExternalUrl(url)) void shell.openExternal(url).catch(() => undefined);
  });

  mainWindow.once('ready-to-show', () => {
    reportDesktopPerformance('desktop-window-create-to-ready', windowStartedAt);
    reportDesktopPerformance('desktop-process-to-window-ready');
  });

  let loading: Promise<void>;
  if (process.env.ELECTRON_RENDERER_URL) {
    const rendererUrl = new URL(process.env.ELECTRON_RENDERER_URL);
    if (process.env.AGENTCTL_PERF === '1') rendererUrl.searchParams.set('perf', '1');
    loading = mainWindow.loadURL(rendererUrl.toString());
  } else {
    loading = mainWindow.loadFile(
      path.join(__dirname, '../renderer/index.html'),
      process.env.AGENTCTL_PERF === '1' ? { query: { perf: '1' } } : undefined,
    );
  }

  void loading.catch((error: unknown) => {
    if (contents.isDestroyed()) return;
    process.stderr.write(`Renderer failed to load: ${String(error)}\n`);
    process.exitCode = 1;
    app.quit();
  });

  mainWindow.on('closed', () => {
    rendererReady = false;
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
