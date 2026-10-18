import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vite-plus/test';
import { FileCacheStorage } from './provider-descriptor.js';
import { withCacheWriterLock } from './writer-lock.js';

const descriptor = {
  status: 'ready' as const,
  authMethods: [],
  configOptions: [],
  supportsDynamicModel: false,
  supportsDynamicConfig: false,
};

test('a live writer keeps exclusive ownership and a killed writer releases it automatically', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-writer-lock-'));
  const file = path.join(directory, 'cache.json');
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import { DatabaseSync } from 'node:sqlite';
    const db = new DatabaseSync(process.argv[1]);
    db.exec('BEGIN IMMEDIATE');
    process.stdout.write('locked');
    setInterval(() => {}, 1000);
  `,
      `${file}.writer-lock.sqlite`,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  try {
    expect(String((await once(child.stdout!, 'data'))[0])).toBe('locked');
    const storage = new FileCacheStorage(file);
    await storage.set('blocked', descriptor);
    expect(await storage.get('blocked')).toBeNull();
    expect(child.exitCode).toBeNull();
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
    await storage.set('recovered', descriptor);
    expect(await storage.get('recovered')).toEqual(descriptor);
    expect(await fs.stat(`${file}.writer-lock.sqlite`)).toBeDefined();
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('legacy orphan flags cannot block new writes and exceptions release ownership', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-writer-recovery-'));
  const file = path.join(directory, 'cache.json');
  try {
    await fs.writeFile(`${file}.lock`, '');
    await expect(
      withCacheWriterLock(file, async () => {
        throw new Error('failed write');
      }),
    ).rejects.toThrow('failed write');
    const storage = new FileCacheStorage(file);
    await storage.set('new', descriptor);
    expect(await storage.get('new')).toEqual(descriptor);
    expect(await fs.readFile(`${file}.lock`, 'utf8')).toBe('');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
