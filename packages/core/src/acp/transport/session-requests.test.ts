import { expect, test, vi } from 'vite-plus/test';
import { cancellableCallbacks } from './session-requests.js';
import type { AgentSessionCallbacks } from '../../agent/types.js';

const permission = { permissionId: 'permission', toolCall: { name: 'tool' } };

test('session cancellation cancels pending consent and late requests until the next turn', async () => {
  const consent = vi.fn<AgentSessionCallbacks['onRequestPermission']>(
    () => new Promise<never>(() => {}),
  );
  const requests = cancellableCallbacks({ onUpdate() {}, onRequestPermission: consent });
  const pending = requests.callbacks.onRequestPermission(permission);
  requests.cancel();
  expect(await pending).toEqual({ allowed: false, cancelled: true });
  expect(consent.mock.calls[0][1]?.aborted).toBe(true);
  expect(await requests.callbacks.onRequestPermission(permission)).toEqual({
    allowed: false,
    cancelled: true,
  });
  expect(consent).toHaveBeenCalledOnce();
  requests.beginTurn();
  consent.mockResolvedValueOnce({ allowed: true });
  expect(await requests.callbacks.onRequestPermission(permission)).toEqual({ allowed: true });
});

test('request and session cancellation leave another session usable', async () => {
  const consent = vi.fn<AgentSessionCallbacks['onRequestPermission']>(
    () => new Promise<never>(() => {}),
  );
  const first = cancellableCallbacks({ onUpdate() {}, onRequestPermission: consent });
  const second = cancellableCallbacks({ onUpdate() {}, onRequestPermission: consent });
  const request = new AbortController();
  const one = first.callbacks.onRequestPermission(permission, request.signal);
  const two = second.callbacks.onRequestPermission(permission);
  request.abort();
  expect(await one).toEqual({ allowed: false, cancelled: true });
  expect(consent.mock.calls[1][1]?.aborted).toBe(false);
  first.cancel();
  expect(consent.mock.calls[1][1]?.aborted).toBe(false);
  second.cancel();
  expect(await two).toEqual({ allowed: false, cancelled: true });
});

test('session cancellation cancels pending elicitation', async () => {
  const requests = cancellableCallbacks({
    onUpdate() {},
    onRequestPermission: async () => ({ allowed: false }),
    onRequestElicitation: () => new Promise<never>(() => {}),
  });
  const pending = requests.callbacks.onRequestElicitation!({
    id: 'choose',
    mode: 'form',
    message: 'Choose',
  });
  requests.cancel();
  expect(await pending).toEqual({ action: 'cancel' });
});
