import { ProviderSync } from './provider-sync.js';
import { ProviderStore } from './provider-store.js';
import { ProviderLauncher } from './provider-launcher.js';
import { BinaryInstaller } from './binary-installer.js';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import { createDatabase } from '../../db/index.js';
import { RegistryFetcher } from './registry-fetcher.js';

afterEach(() => vi.unstubAllGlobals());

test('shutdown aborts in-flight acquisition and rejects further fetches', async () => {
  let requestSignal!: AbortSignal;
  const fetch = vi.fn(
    (_url: string, options: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        requestSignal = options.signal!;
        requestSignal.addEventListener('abort', () => reject(requestSignal.reason), { once: true });
      }),
  );
  vi.stubGlobal('fetch', fetch);
  const db = createDatabase(':memory:');
  const fetcher = new RegistryFetcher(db);
  const store = new ProviderStore(db);
  const sync = new ProviderSync(fetcher, store, new ProviderLauncher(store, new BinaryInstaller()));
  const request = fetcher.fetch();
  const rejected = expect(request).rejects.toThrow('disposed');
  expect(fetcher.fetch()).toBe(request);
  const syncing = sync.sync();
  const syncRejected = expect(syncing).rejects.toThrow('disposed');
  fetcher.dispose();
  expect(requestSignal.aborted).toBe(true);
  await Promise.all([rejected, syncRejected]);
  expect(store.getSetting('registrySyncError')).toBeUndefined();
  await expect(fetcher.fetch()).rejects.toThrow('disposed');
  expect(fetch).toHaveBeenCalledOnce();
});
