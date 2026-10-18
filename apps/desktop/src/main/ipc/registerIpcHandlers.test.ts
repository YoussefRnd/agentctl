import { beforeEach, expect, it, vi } from 'vite-plus/test';
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => unknown>(),
  listeners: new Map<string, (...args: any[]) => unknown>(),
  contents: { mainFrame: {} },
  minimize: vi.fn(),
  external: vi.fn(async () => {}),
  tray: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { getVersion: () => 'test', quit: vi.fn() },
  shell: { openExternal: mocks.external },
  ipcMain: {
    on: (channel: string, callback: (...args: any[]) => unknown) =>
      mocks.listeners.set(channel, callback),
    handle: (channel: string, callback: (...args: any[]) => unknown) =>
      mocks.handlers.set(channel, callback),
    removeHandler: (channel: string) => mocks.handlers.delete(channel),
    removeListener: (channel: string) => mocks.listeners.delete(channel),
  },
}));
vi.mock('../windows/mainWindow', () => ({
  getMainWindow: () => ({ webContents: mocks.contents, minimize: mocks.minimize }),
  rendererNavigationReady: vi.fn(),
}));
vi.mock('../server/serverManager', () => ({
  getServerPort: () => 1234,
  getServerSecret: () => 'secret',
}));
vi.mock('../tray/trayManager', () => ({ updateTrayStatus: mocks.tray }));
vi.mock('../windowControls', () => ({ resolveWindowControls: () => ({}) }));
import { registerIpcHandlers } from './registerIpcHandlers';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.handlers.clear();
  mocks.listeners.clear();
});
it('rejects other windows and subframes for reads and native commands', () => {
  const dispose = registerIpcHandlers();
  const trusted = { sender: mocks.contents, senderFrame: mocks.contents.mainFrame };
  for (const event of [
    { sender: {}, senderFrame: {} },
    { sender: mocks.contents, senderFrame: {} },
  ]) {
    expect(() => mocks.handlers.get('server:get-secret')!(event)).toThrow('Unauthorized');
    mocks.listeners.get('win:minimize')!(event);
  }
  expect(mocks.minimize).not.toHaveBeenCalled();
  expect(mocks.handlers.get('server:get-secret')!(trusted)).toBe('secret');
  mocks.listeners.get('win:minimize')!(trusted);
  expect(mocks.minimize).toHaveBeenCalledOnce();
  dispose();
  dispose();
  expect(mocks.handlers.size + mocks.listeners.size).toBe(0);
});
it('validates external URLs and tray payloads at the native boundary', () => {
  const dispose = registerIpcHandlers();
  const event = { sender: mocks.contents, senderFrame: mocks.contents.mainFrame };
  for (const value of [null, {}, 'file:///etc/passwd', 'javascript:alert(1)'])
    mocks.listeners.get('win:open-external')!(event, value);
  mocks.listeners.get('win:open-external')!(event, 'https://example.com');
  expect(mocks.external).toHaveBeenCalledExactlyOnceWith('https://example.com');
  for (const value of [
    null,
    { runningCount: -1, needsAttentionCount: 0 },
    { runningCount: '1', needsAttentionCount: 0 },
  ])
    mocks.listeners.get('tray:update-status')!(event, value);
  mocks.listeners.get('tray:update-status')!(event, { runningCount: 1, needsAttentionCount: 0 });
  expect(mocks.tray).toHaveBeenCalledOnce();
  dispose();
});
