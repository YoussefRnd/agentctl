import { describe, test, expect } from 'vitest';
import { ElicitationStore } from './elicitation-store.js';

describe('ElicitationStore', () => {
  test('creates, responds to, and resolves form elicitations', async () => {
    const store = new ElicitationStore();

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
    const store = new ElicitationStore();

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
