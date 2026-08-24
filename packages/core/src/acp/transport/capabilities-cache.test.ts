import { test, describe, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileCacheStorage, getCacheKey } from './capabilities-cache.js';
import type { AgentProbeResult } from '../types.js';

const sampleResult: AgentProbeResult = {
  status: 'ready',
  configOptions: [],
  authMethods: [],
  supportsDynamicModel: false,
  supportsDynamicConfig: false,
};

describe('FileCacheStorage', () => {
  let file: string;

  beforeEach(() => {
    file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agentctl-cache-')), 'cache.json');
  });

  test('stores and returns probe results', async () => {
    const storage = new FileCacheStorage(file);
    await storage.set('k1', sampleResult);
    const res = await storage.get('k1');
    expect(res).toEqual(sampleResult);
  });

  test('treats stale entries as misses', async () => {
    const storage = new FileCacheStorage(file);
    await storage.set('k1', sampleResult);

    // Age the entry beyond the 1h TTL.
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, { ts: number }>;
    manifest.k1.ts = Date.now() - 2 * 60 * 60 * 1000;
    fs.writeFileSync(file, JSON.stringify(manifest));

    expect(await storage.get('k1')).toBeNull();
  });

  test('missing keys are misses', async () => {
    const storage = new FileCacheStorage(file);
    expect(await storage.get('nope')).toBeNull();
  });

  test('deletes entries', async () => {
    const storage = new FileCacheStorage(file);
    await storage.set('k1', sampleResult);
    expect(await storage.get('k1')).toEqual(sampleResult);
    await storage.delete('k1');
    expect(await storage.get('k1')).toBeNull();
  });

  test('clears entire manifest cache', async () => {
    const storage = new FileCacheStorage(file);
    await storage.set('k1', sampleResult);
    await storage.clear();
    expect(await storage.get('k1')).toBeNull();
  });

  test('cache keys are stable per command+args+env and sort keys deterministically', () => {
    const a = getCacheKey('cmd', ['--x'], { A: '1', B: '2' });
    const b = getCacheKey('cmd', ['--x'], { B: '2', A: '1' });
    const c = getCacheKey('cmd', ['--y'], { A: '1' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
