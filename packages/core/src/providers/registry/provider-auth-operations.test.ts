import { expect, test, vi } from 'vite-plus/test';
import { ProviderAuthOperations } from './provider-auth-operations.js';

test('cancellation settles the caller but retains the credential lane until adapter cleanup', async () => {
  const operations = new ProviderAuthOperations();
  let finish!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const first = operations.serialize('family', async () => {
    const attempt = operations.begin('profile-a', 10000, undefined, 'family');
    try {
      const work = new Promise<void>((resolve) => {
        finish = resolve;
      });
      started();
      await attempt.race(work);
    } finally {
      attempt.close();
    }
  });
  const rejected = expect(first).rejects.toThrow('cancelled');
  await ready;
  const next = vi.fn(async () => undefined);
  const second = operations.serialize('family', next);
  operations.cancel('profile-a');
  await rejected;
  await Promise.resolve();
  expect(next).not.toHaveBeenCalled();
  finish();
  await second;
  expect(next).toHaveBeenCalledOnce();
  await operations.dispose();
});
