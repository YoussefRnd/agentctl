import { test, describe, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileCacheStorage, getCacheKey } from './capabilities-cache.js';
import type { AgentDescriptor } from '../../agent/types.js';
import { EMPTY_AGENT_FEATURES } from '@agentctl/shared';

const sampleResult: AgentDescriptor = {
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

  test('hydrates persisted capability snapshot timestamps', async () => {
    const storage = new FileCacheStorage(file);
    const verifiedAt = new Date('2026-09-14T12:00:00.000Z');
    await storage.set('snapshot', {
      ...sampleResult,
      features: EMPTY_AGENT_FEATURES,
      snapshot: {
        features: EMPTY_AGENT_FEATURES,
        source: 'handshake',
        protocolVersion: '1',
        providerVersion: '2.0.0',
        verifiedAt,
      },
    });

    const result = await storage.get('snapshot');
    expect(result?.snapshot?.verifiedAt).toEqual(verifiedAt);
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

  test('cache keys change when the provider executable changes', () => {
    const executable = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agentctl-bin-')), 'agent');
    fs.writeFileSync(executable, 'v1');
    const first = getCacheKey(executable, [], {});
    fs.writeFileSync(executable, 'version-two');
    const second = getCacheKey(executable, [], {});
    expect(first).not.toBe(second);
  });

  test('cache keys change when providerVersion or protocolVersion changes', () => {
    const k1 = getCacheKey('cmd', ['--x'], {}, { providerVersion: '1.0.0' });
    const k2 = getCacheKey('cmd', ['--x'], {}, { providerVersion: '1.1.0' });
    const k3 = getCacheKey('cmd', ['--x'], {}, { providerVersion: '1.0.0', protocolVersion: 'v2' });
    expect(k1).not.toBe(k2);
    expect(k1).not.toBe(k3);
  });
});
