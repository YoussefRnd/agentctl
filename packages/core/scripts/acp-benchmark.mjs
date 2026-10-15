import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { FileCacheStorage } from '../dist/acp/cache/provider-descriptor.js';
import { AcpSubagentSessions } from '../dist/acp/protocol/subagent-sessions.js';
import { displayAcpContent } from '../dist/acp/protocol/content.js';
import { AcpUpdateQueue } from '../dist/acp/transport/update-drain.js';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-acp-benchmark-'));
const file = path.join(directory, 'cache.json');
const chunk = { type: 'text', text: '🙂'.repeat(64) };
const chunks = 2048;
const samples = 5;
const measure = async (work) => {
  const start = performance.now();
  await work();
  return performance.now() - start;
};
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const durations = { directedBefore: [], directedAfter: [], cacheBefore: [], cacheAfter: [] };

try {
  const result = {
    status: 'ready',
    authMethods: [],
    supportsDynamicModel: true,
    supportsDynamicConfig: true,
    configOptions: [
      {
        id: 'model',
        name: 'Model',
        type: 'select',
        currentValue: '0',
        options: Array.from({ length: 64 }, (_, index) => ({
          value: String(index),
          name: `Model ${index}`,
          description: 'Synthetic model description for manifest measurement.',
        })),
      },
    ],
  };
  await fs.writeFile(
    file,
    JSON.stringify(
      Object.fromEntries(
        Array.from({ length: 256 }, (_, index) => [String(index), { ts: Date.now(), result }]),
      ),
    ),
  );
  const cache = new FileCacheStorage(file);
  await cache.get('0');
  let current = '';
  const callbacks = {
    onUpdate: (event) => {
      if (event.type === 'session_message') current = event.content;
    },
    onRequestPermission: async () => ({ allowed: false }),
  };
  const router = new AcpSubagentSessions((id) => {
    if (id !== 'root') throw new Error('Unknown root');
    return { callbacks };
  });
  for (let sample = -1; sample < samples; sample++) {
    // Reproduce the old reconstruction algorithm; this is not a live-provider benchmark.
    const before = await measure(async () => {
      let content = [];
      for (let index = 0; index < chunks; index++) {
        content = [...content, chunk];
        current = content.map(displayAcpContent).join('');
        await Promise.resolve();
      }
    });
    const expected = current;
    const after = await measure(async () => {
      for (let index = 0; index < chunks; index++)
        await router.update({
          sessionId: 'root',
          update: { sessionUpdate: 'session_message_chunk', messageId: 'message', content: chunk },
        });
    });
    assert.equal(current, expected);
    router.releaseRoot('root');
    assert.deepEqual(router.snapshot(), { children: 0, messages: 0, bytes: 0 });
    const cacheBefore = await measure(async () => {
      for (let index = 0; index < 100; index++) {
        const manifest = JSON.parse(fsSync.readFileSync(file, 'utf8'));
        assert.equal(manifest['0'].result.status, 'ready');
        await Promise.resolve();
      }
    });
    const cacheAfter = await measure(async () => {
      for (let index = 0; index < 100; index++)
        assert.equal((await cache.get('0')).status, 'ready');
    });
    if (sample >= 0) {
      durations.directedBefore.push(before);
      durations.directedAfter.push(after);
      durations.cacheBefore.push(cacheBefore);
      durations.cacheAfter.push(cacheAfter);
    }
  }
  // Resource assertions survive timing noise: churn must release all connection-owned state.
  for (let index = 0; index < 500; index++) {
    await router.update({
      sessionId: 'root',
      update: { sessionUpdate: 'subagent_update', sessionId: `child-${index}` },
    });
    await router.update({
      sessionId: 'root',
      update: { sessionUpdate: 'session_message', messageId: String(index), content: [chunk] },
    });
    router.releaseRoot('root');
  }
  assert.deepEqual(router.snapshot(), { children: 0, messages: 0, bytes: 0 });
  const queue = new AcpUpdateQueue();
  const held = Promise.withResolvers();
  const pending = Array.from({ length: 100 }, () => queue.enqueue(() => held.promise, chunk));
  held.resolve();
  await Promise.all(pending);
  await queue.drain();
  assert.equal(queue.snapshot().bytes, 0);
  console.log(
    JSON.stringify(
      {
        benchmarkVersion: 1,
        node: process.version,
        platform: process.platform,
        samples,
        chunks,
        messageBytes: Buffer.byteLength(chunk.text) * chunks,
        descriptorCount: 256,
        cacheReads: 100,
        mediansMs: Object.fromEntries(
          Object.entries(durations).map(([key, values]) => [key, median(values)]),
        ),
        samplesMs: durations,
        retainedAfterChurn: router.snapshot(),
        updateQueue: queue.snapshot(),
        scope:
          'Synthetic reducer and cache comparison; no provider, UI or network latency measured.',
      },
      null,
      2,
    ),
  );
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
