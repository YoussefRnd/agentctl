import { expect, test, vi } from 'vite-plus/test';
import { createApiQueryClient } from './query-client.js';

test('creates isolated host-owned caches and accepts host error policy', async () => {
  const error = vi.fn();
  const first = createApiQueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { onError: error } },
  });
  const second = createApiQueryClient();
  first.setQueryData(['session', 'one'], 1);
  expect(second.getQueryData(['session', 'one'])).toBeUndefined();
  const mutation = first.getMutationCache().build(first, {
    mutationFn: async () => {
      throw new Error('Host error');
    },
  });
  await expect(mutation.execute(undefined)).rejects.toThrow('Host error');
  expect(error).toHaveBeenCalledOnce();
  expect(first.getDefaultOptions().queries).toMatchObject({
    staleTime: 10000,
    retry: false,
    refetchOnReconnect: true,
  });
  first.clear();
  second.clear();
});
