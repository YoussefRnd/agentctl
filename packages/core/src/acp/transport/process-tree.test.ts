import fs from 'node:fs';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { expect, test } from 'vite-plus/test';
import {
  spawnManagedProcess,
  terminateChildProcess,
  withTimeout,
} from './acp-process-lifecycle.js';

test.skipIf(process.platform !== 'linux')(
  'stops an owned subprocess tree and leaves unrelated processes running',
  async () => {
    const sentinel = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    const managed = spawnManagedProcess({
      command: process.execPath,
      args: [
        '-e',
        `
    const { spawn } = require('node:child_process');
    process.on('SIGTERM', () => {});
    const worker = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    console.log(worker.pid);
    setInterval(() => {}, 1000);
  `,
      ],
    });
    void managed.transport.closed.catch(() => undefined);
    try {
      const [line] = await withTimeout(
        once(managed.child.stdout!, 'data'),
        5000,
        'starting test worker',
      );
      const workerPid = Number(String(line).trim());
      expect(workerPid).toBeGreaterThan(0);
      const exit = once(managed.child, 'exit');
      terminateChildProcess(managed.child, undefined, 50);
      await withTimeout(exit, 5000, 'stopping test process tree');
      const workerStat = fs.existsSync(`/proc/${workerPid}/stat`)
        ? fs.readFileSync(`/proc/${workerPid}/stat`, 'utf8')
        : '';
      expect(workerStat === '' || workerStat.split(') ')[1]?.startsWith('Z')).toBe(true);
      expect(sentinel.exitCode).toBeNull();
      expect(sentinel.killed).toBe(false);
    } finally {
      managed.transport.kill('SIGKILL');
      sentinel.kill('SIGKILL');
      await managed.transport.closed.catch(() => undefined);
    }
  },
);
