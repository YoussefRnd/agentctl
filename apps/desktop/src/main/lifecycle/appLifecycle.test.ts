import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ create: vi.fn(), quit: vi.fn() }));
const application = Object.assign(new EventEmitter(), {
  requestSingleInstanceLock: () => true,
  quit: state.quit,
  exit: vi.fn(),
  isPackaged: true,
  commandLine: { appendSwitch: vi.fn() },
  setAsDefaultProtocolClient: vi.fn(),
});
vi.mock('electron', () => ({
  app: application,
  Menu: {},
  BrowserWindow: { getAllWindows: () => [] },
}));
vi.mock('../windows/mainWindow', () => ({
  getMainWindow: () => null,
  createMainWindow: state.create,
  handleDeepLink: vi.fn(),
}));
afterEach(() => {
  application.removeAllListeners();
  vi.restoreAllMocks();
});
it('ignores activation before readiness and after shutdown begins', async () => {
  vi.spyOn(process, 'once').mockImplementation(() => process);
  const { initAppLifecycle } = await import('./appLifecycle.js');
  let ready = false;
  const stop = vi.fn(async () => {});
  initAppLifecycle(stop, () => ready);
  application.emit('activate');
  expect(state.create).not.toHaveBeenCalled();
  ready = true;
  application.emit('activate');
  expect(state.create).toHaveBeenCalledOnce();
  const event = { preventDefault: vi.fn() };
  application.emit('before-quit', event);
  application.emit('before-quit', event);
  application.emit('activate');
  expect(state.create).toHaveBeenCalledOnce();
  expect(stop).toHaveBeenCalledOnce();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
});
