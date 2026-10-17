import { test, describe, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileCacheStorage } from '../cache/provider-descriptor.js';
import { getCacheKey } from '../cache/launch-identity.js';
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

  test('serializes concurrent writers from separate storage instances without losing keys', async () => {
    const first = new FileCacheStorage(file);
    const second = new FileCacheStorage(file);
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        (index % 2 ? first : second).set(String(index), sampleResult),
      ),
    );
    for (let index = 0; index < 12; index++)
      expect(await first.get(String(index))).toEqual(sampleResult);
    expect(fs.readdirSync(path.dirname(file))).toEqual([
      'cache.json',
      'cache.json.writer-lock.sqlite',
    ]);
  });

  test('prunes expired records on mutation and limits retained descriptors', async () => {
    const expired = { ts: Date.now() - 2 * 60 * 60 * 1000, result: sampleResult };
    const records = Object.fromEntries(
      Array.from({ length: 260 }, (_, index) => [
        String(index),
        { ts: Date.now() - index, result: sampleResult },
      ]),
    );
    fs.writeFileSync(file, JSON.stringify({ ...records, expired }));
    const storage = new FileCacheStorage(file);
    await storage.set('new', sampleResult);
    const retained = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    expect(Object.keys(retained)).toHaveLength(256);
    expect(retained).not.toHaveProperty('expired');
    expect(retained).toHaveProperty('new');
    expect(await storage.get('259')).toBeNull();
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

test('v1 rejects every unnegotiated protocol version even with a v1-shaped response', async () => {
  const { initializeAcpConnection } = await import('../v1/capabilities.js');
  const { vi } = await import('vitest');
  const { PROTOCOL_VERSION } = await import('@agentclientprotocol/sdk');
  const initialize = vi
    .fn()
    .mockResolvedValue({ protocolVersion: PROTOCOL_VERSION + 1, agentCapabilities: {} });
  await expect(initializeAcpConnection({ initialize })).rejects.toThrow(
    'Unsupported ACP protocol version',
  );
});
