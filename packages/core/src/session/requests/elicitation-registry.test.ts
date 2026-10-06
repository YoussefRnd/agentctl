import { describe, test, expect } from 'vitest';
import { ElicitationRegistry } from './elicitation-registry.js';

describe('ElicitationRegistry', () => {
  test('creates, responds to, and resolves form elicitations', async () => {
    const store = new ElicitationRegistry();

    const { item, promise } = store.createElicitation({
      id: 'el-1',
      mode: 'form',
      message: 'Choose a name',
      form: {
        title: 'Authentication Form',
        fields: [{ id: 'token', label: 'Token', type: 'string', required: true }],
      },
    });

    expect(item.status).toBe('pending');
    expect(store.getElicitations()).toHaveLength(1);

    const ok = store.respondToElicitation('el-1', {
      action: 'submit',
      values: { token: 'secret-123' },
    });

    expect(ok).toBe(true);
    const result = await promise;
    expect(result.action).toBe('submit');
    expect(result.values?.token).toBe('secret-123');

    const updated = store.getElicitation('el-1');
    expect(updated?.status).toBe('completed');
  });

  test('cancels pending elicitations on store clear', async () => {
    const store = new ElicitationRegistry();

    const { promise } = store.createElicitation({
      id: 'el-2',
      mode: 'url',
      message: 'Authenticate',
      url: { url: 'https://auth.example.com' },
    });

    store.clear();
    const result = await promise;
    expect(result.action).toBe('cancel');
  });
});

test('keeps invalid submissions pending so a corrected response can settle the request', async () => {
  const registry = new ElicitationRegistry();
  const { item, promise } = registry.createElicitation({
    id: 'validate',
    mode: 'form',
    message: 'Email address',
    form: {
      fields: [{ id: 'email', label: 'Email', type: 'string', required: true, format: 'email' }],
    },
  });
  expect(() =>
    registry.respondToElicitation('validate', { action: 'submit', values: { email: 'bad' } }),
  ).toThrow('Invalid value');
  expect(item.status).toBe('pending');
  expect(
    registry.respondToElicitation('validate', {
      action: 'submit',
      values: { email: 'user@example.com' },
    }),
  ).toBe(true);
  expect(await promise).toMatchObject({ action: 'submit', values: { email: 'user@example.com' } });
});
