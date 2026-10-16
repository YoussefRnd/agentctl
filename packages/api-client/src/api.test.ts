import { afterEach, expect, it, vi } from 'vitest';
import { api } from './api.js';

afterEach(() => vi.restoreAllMocks());

it('cancels the underlying HTTP request when a captured diff query is abandoned', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    (_input, options) =>
      new Promise((_resolve, reject) => {
        const signal = options?.signal;
        if (signal?.aborted) reject(new DOMException('Aborted', 'AbortError'));
        else
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
      }),
  );
  const controller = new AbortController();
  const request = api.getRepositoryReview({
    params: { id: '11111111-1111-4111-8111-111111111111' },
    query: { filePath: 'file.ts', fromRevision: 'revision:before', toRevision: 'revision:after' },
    fetchOptions: { signal: controller.signal },
  });
  controller.abort();
  await expect(request).rejects.toMatchObject({ name: 'AbortError' });
});
