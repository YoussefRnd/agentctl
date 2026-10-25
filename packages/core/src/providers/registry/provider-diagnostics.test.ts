import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import { OperationDiagnostics } from '../../agent/operation-diagnostics.js';
import { noopLogger } from '../../logger.js';
import { preserveProviderFailure } from './provider-diagnostics.js';
import { ProviderLauncher } from './provider-launcher.js';
import { ProviderStore } from './provider-store.js';
import { BinaryInstaller } from './binary-installer.js';
import { createDatabase } from '../../db/index.js';
import type { AgentDriver } from '../../agent/types.js';

let home: string;
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-diagnostics-'));
  vi.stubEnv('AGENTCTL_HOME', home);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(home, { recursive: true, force: true });
});

test('bounds copied logs, skips symbolic links, and retains recent failures across attempts', async () => {
  const cache = path.join(home, 'cache');
  await fs.mkdir(path.join(cache, '_logs'), { recursive: true });
  for (let i = 0; i < 7; i++)
    await fs.writeFile(path.join(cache, '_logs', `${i}.log`), 'entry\n'.repeat(50_000));
  await fs.symlink(path.join(home, 'private-file'), path.join(cache, '_logs', 'z.log'));
  await fs.writeFile(path.join(home, 'private-file'), 'must not be copied');
  const root = path.join(home, 'diagnostics', 'providers');
  for (let i = 0; i < 20; i++)
    await fs.mkdir(
      path.join(
        root,
        `2020-01-01T00-00-00-000Z-00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
      ),
      { recursive: true },
    );
  const trace = new OperationDiagnostics('probe', noopLogger);
  trace.stage('connecting');
  const reportPath = await preserveProviderFailure({
    trace,
    providerId: 'agent',
    error: new Error('failed'),
    npmCache: cache,
    logger: noopLogger,
  });
  expect(reportPath).toBeDefined();
  const report = JSON.parse(await fs.readFile(reportPath!, 'utf8'));
  expect(report.npmLogs).toHaveLength(5);
  for (const log of report.npmLogs) {
    const p = path.join(path.dirname(reportPath!), log);
    expect((await fs.stat(p)).size).toBeLessThanOrEqual(256 * 1024);
    expect(await fs.readFile(p, 'utf8')).not.toContain('must not be copied');
  }
  expect(await fs.readdir(root)).toHaveLength(20);
});

test('connection-only checks preserve npm logs and leave the original error intact', async () => {
  const cache = path.join(home, 'cache');
  await fs.mkdir(path.join(cache, '_logs'), { recursive: true });
  await fs.writeFile(path.join(cache, '_logs', '1.log'), 'download ETIMEDOUT');
  const store = new ProviderStore(createDatabase(':memory:'));
  store.upsert('test-agent', {
    name: 'Test',
    command: 'npx',
    installSource: 'npx',
    installState: 'system_available',
  });
  const launcher = new ProviderLauncher(store, new BinaryInstaller());
  vi.spyOn(launcher, 'prepareLaunch').mockImplementation(async (_id, launch) => launch);
  const error = Object.assign(new Error('probe timed out'), { code: 'ETIMEDOUT' });
  const inspectProvider = vi.fn().mockRejectedValue(error);
  await expect(
    launcher.inspectLaunch(
      'test-agent',
      { inspectProvider } as unknown as AgentDriver,
      { command: 'npx', args: [], env: { npm_config_cache: cache } },
      '1.0.0',
    ),
  ).rejects.toBe(error);
  expect(inspectProvider).toHaveBeenCalledOnce();
  const root = path.join(home, 'diagnostics', 'providers');
  const [folder] = await fs.readdir(root);
  const report = JSON.parse(await fs.readFile(path.join(root, folder, 'report.json'), 'utf8'));
  expect(report).toMatchObject({
    version: '1.0.0',
    operation: 'probe',
    error: { code: 'ETIMEDOUT' },
    npmLogs: ['npm-1.log'],
  });
});
