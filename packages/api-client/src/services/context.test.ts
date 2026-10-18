import { afterEach, expect, it, vi } from 'vite-plus/test';
import { apiClient } from '../api-client.js';
import { searchContext } from './context.js';

afterEach(() => vi.restoreAllMocks());

it('forwards cancellation and encodes context search parameters', async () => {
  const fetch = vi.spyOn(apiClient, 'fetch').mockResolvedValue({ items: [] });
  const controller = new AbortController();
  await searchContext('project-1', 'src/file name.ts', 'file', 'projects', controller.signal);
  expect(fetch).toHaveBeenCalledWith(
    '/api/projects/project-1/context/search?q=src%2Ffile+name.ts&type=file',
    { signal: controller.signal },
  );
});
