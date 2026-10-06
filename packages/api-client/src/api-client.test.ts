import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from './api-client.js';
import { providerService } from './services/providers.js';

afterEach(() => vi.restoreAllMocks());

describe.each(['fetch', 'fetchWithStatus'] as const)('%s response parsing', (method) => {
  it.each(['<html>Web preview</html>', '', '{"incomplete":'])(
    'rejects invalid successful JSON: %j',
    async (body) => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }));
      await expect(apiClient[method]('/api/test')).rejects.toMatchObject({
        status: 200,
        message: expect.stringContaining('Invalid JSON response'),
      });
    },
  );

  it('accepts an intentional no-content response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    const result = await apiClient[method]('/api/test');
    expect(method === 'fetch' ? result : (result as { body: unknown }).body).toBeNull();
  });

  it('preserves HTTP error details', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"error":"Agent unavailable"}', { status: 400 }),
    );
    await expect(apiClient[method]('/api/test')).rejects.toMatchObject({
      status: 400,
      message: 'Agent unavailable',
    });
  });
});

describe.each(['getProviders', 'getRegistry'] as const)('%s contract validation', (method) => {
  it.each([null, {}, [{}], [{ id: 'agent', label: 42 }]])(
    'rejects malformed agent data: %j',
    async (body) => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body)));
      await expect(providerService[method]()).rejects.toMatchObject({
        message: expect.stringContaining('Invalid agent list'),
      });
    },
  );

  it('accepts an empty catalog and applies contract defaults to valid agents', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('[]'))
      .mockResolvedValueOnce(new Response('[{"id":"agent","label":"Agent","command":"agent"}]'));
    await expect(providerService[method]()).resolves.toEqual([]);
    await expect(providerService[method]()).resolves.toMatchObject([
      { id: 'agent', label: 'Agent', authMethods: [], customEnvConfigured: {} },
    ]);
  });
});
