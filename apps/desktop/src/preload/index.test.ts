import { expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  api: undefined as unknown,
  listeners: new Map<string, (...args: unknown[]) => void>(),
  send: vi.fn(),
}));
vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: unknown) => {
      state.api = api;
    },
  },
  webUtils: { getPathForFile: vi.fn() },
  ipcRenderer: {
    on: (name: string, listener: (...args: unknown[]) => void) =>
      state.listeners.set(name, listener),
    removeListener: (name: string) => state.listeners.delete(name),
    send: state.send,
    invoke: vi.fn(),
  },
}));
import type { ElectronAPI } from '@agentctl/shared';
import './index';
it('exposes disposable native subscriptions and validates navigation payloads', () => {
  const api = state.api as ElectronAPI;
  for (const [method, channel] of [
    ['onNavigate', 'navigate'],
    ['onDeepLink', 'deep-link'],
  ] as const) {
    const callback = vi.fn();
    const dispose = api[method](callback);
    const listener = state.listeners.get(channel)!;
    listener({}, { path: 'wrong' });
    listener({}, '/sessions/one');
    expect(callback).toHaveBeenCalledExactlyOnceWith('/sessions/one');
    dispose();
    dispose();
    expect(state.listeners.has(channel)).toBe(false);
  }
  expect(state.send).toHaveBeenCalledWith('navigation:ready');
});
