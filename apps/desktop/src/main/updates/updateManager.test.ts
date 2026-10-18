import { EventEmitter } from 'node:events';
import { beforeEach, expect, it, vi } from 'vite-plus/test';
const state = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  callbacks: new Map<string, (...args: any[]) => any>(),
  trusted: true,
  send: vi.fn(),
  install: vi.fn(),
}));
const updater = Object.assign(new EventEmitter(), {
  autoDownload: false,
  checkForUpdates: vi.fn(async () => null),
  quitAndInstall: state.install,
});
vi.mock('electron-updater', () => ({ autoUpdater: updater }));
vi.mock('electron', () => ({
  app: { isPackaged: false },
  ipcMain: {
    handle: (name: string, handler: (...args: any[]) => any) => state.handlers.set(name, handler),
    on: (name: string, handler: (...args: any[]) => any) => state.callbacks.set(name, handler),
    removeHandler: (name: string) => state.handlers.delete(name),
    removeListener: (name: string) => state.callbacks.delete(name),
  },
}));
vi.mock('../ipc/sender', () => ({ isTrustedSender: () => state.trusted }));
vi.mock('../windows/mainWindow', () => ({
  getMainWindow: () => ({ webContents: { send: state.send } }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  state.trusted = true;
});
it('disposes updater listeners and pending development checks, and gates installation', async () => {
  vi.useFakeTimers();
  try {
    const manager = await import('./updateManager.js');
    const dispose = manager.setupAutoUpdater();
    const disposeIpc = manager.registerUpdateIpc();
    state.callbacks.get('update:install')!({});
    expect(state.install).not.toHaveBeenCalled();
    updater.emit('update-downloaded', { version: '1.0.0' });
    state.trusted = false;
    expect(() => state.handlers.get('update:get-state')!({})).toThrow('Unauthorized');
    state.callbacks.get('update:install')!({});
    expect(state.install).not.toHaveBeenCalled();
    state.trusted = true;
    state.callbacks.get('update:install')!({});
    expect(state.install).toHaveBeenCalledOnce();
    state.callbacks.get('update:check')!({});
    const calls = state.send.mock.calls.length;
    disposeIpc();
    disposeIpc();
    dispose();
    dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(state.send).toHaveBeenCalledTimes(calls);
    expect(updater.eventNames()).toEqual([]);
    expect(state.handlers.size + state.callbacks.size).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
