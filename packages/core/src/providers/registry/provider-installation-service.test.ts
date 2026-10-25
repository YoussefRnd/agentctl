import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import type { RegistryAgent } from '@agentctl/shared';
import type { AgentDriver } from '../../agent/types.js';
import { createDatabase } from '../../db/index.js';
import { noopLogger } from '../../logger.js';
import { BinaryInstaller } from './binary-installer.js';
import { ProviderStore } from './provider-store.js';
import { ProviderLauncher } from './provider-launcher.js';
import { ProviderOperationCoordinator } from './provider-operation-coordinator.js';
import { ProviderInstallationService } from './provider-installation-service.js';

const mocks = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  execFile: mocks.execFile,
}));

let home: string;
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-diagnostics-install-'));
  vi.stubEnv('AGENTCTL_HOME', home);
  mocks.execFile.mockReset();
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.rm(home, { recursive: true, force: true });
});

function setup(source: 'npx' | 'uvx' = 'npx') {
  const agent: RegistryAgent = {
    id: 'test-agent',
    name: 'Test',
    version: '2.0.0',
    description: '',
    authors: [],
    distribution:
      source === 'npx'
        ? { npx: { package: 'test-agent', args: [], env: { API_TOKEN: 'private-value' } } }
        : { uvx: { package: 'test-agent', args: ['acp'], env: {} } },
  };
  const store = new ProviderStore(createDatabase(':memory:'));
  store.upsert(agent.id, {
    name: 'Test',
    command: 'npx',
    installState: 'system_available',
    installSource: 'npx',
    installedVersion: '1.0.0',
    launchArgs: '["-y","test-agent@1.0.0"]',
    authState: 'authenticated',
    connectionState: 'ready',
  });
  const installer = new BinaryInstaller();
  const launcher = new ProviderLauncher(store, installer, { resolveEnvSync: (env) => env });
  vi.spyOn(launcher, 'isBinaryOnPath').mockResolvedValue(true);
  const probe = vi.spyOn(launcher, 'inspectLaunch');
  const service = new ProviderInstallationService({
    store,
    installer,
    launcher,
    runtime: {} as AgentDriver,
    logger: noopLogger,
    coordinator: new ProviderOperationCoordinator(),
    getAgent: () => agent,
    onStateChange: () => {},
  });
  return { store, service, probe };
}

function npmPreparation(fail: boolean) {
  mocks.execFile.mockImplementation(
    (
      _command: string,
      _args: string[],
      options: { env: NodeJS.ProcessEnv },
      callback: (error: Error | null, stdout?: string, stderr?: string) => void,
    ) => {
      const write = async () => {
        const directory = path.join(options.env.npm_config_cache!, '_logs');
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(
          path.join(directory, '2026-10-25-debug.log'),
          'npm download ETIMEDOUT private-value',
        );
        if (!fail) {
          const tree = path.join(options.env.npm_config_cache!, '_npx', 'fixture');
          const pkg = path.join(tree, 'node_modules', 'test-agent');
          await fs.mkdir(pkg, { recursive: true });
          await fs.mkdir(path.join(tree, 'node_modules', '.bin'), { recursive: true });
          await fs.writeFile(
            path.join(tree, 'package.json'),
            JSON.stringify({ _npx: { packages: ['test-agent@2.0.0'] } }),
          );
          await fs.writeFile(path.join(tree, 'package-lock.json'), '{}');
          await fs.writeFile(
            path.join(pkg, 'package.json'),
            JSON.stringify({
              name: 'test-agent',
              version: '2.0.0',
              bin: { 'test-agent': 'index.js' },
            }),
          );
          await fs.writeFile(path.join(pkg, 'index.js'), '', { mode: 0o755 });
          await fs.writeFile(
            path.join(
              tree,
              'node_modules',
              '.bin',
              'test-agent' + (process.platform === 'win32' ? '.cmd' : ''),
            ),
            '',
            { mode: 0o755 },
          );
        }
      };
      void write().then(
        () =>
          callback(
            fail
              ? Object.assign(new Error('npm failed'), {
                  code: 1,
                  stderr: 'download ETIMEDOUT private-value',
                })
              : null,
            '',
            '',
          ),
        (error: Error) => callback(error),
      );
    },
  );
}

async function reports() {
  const root = path.join(home, 'diagnostics', 'providers');
  return Promise.all(
    (await fs.readdir(root)).map(async (directory) => {
      const location = path.join(root, directory);
      return {
        location,
        report: JSON.parse(await fs.readFile(path.join(location, 'report.json'), 'utf8')),
      };
    }),
  );
}

test('preserves npm failure logs before deleting the rejected cache and keeps the previous launch', async () => {
  const { service, store, probe } = setup();
  npmPreparation(true);

  await expect(service.install('test-agent')).rejects.toThrow('npm failed');

  expect(mocks.execFile).toHaveBeenCalledOnce();
  expect(probe).not.toHaveBeenCalled();
  expect(await fs.readdir(path.join(home, 'provider-npx-cache'))).toEqual([]);
  expect(store.get('test-agent')).toMatchObject({
    installedVersion: '1.0.0',
    connectionState: 'ready',
  });
  const [{ location, report }] = await reports();
  expect(report).toMatchObject({
    failedStage: 'package-preparation',
    error: { code: 1 },
    npmLogs: ['npm-1.log'],
  });
  const log = await fs.readFile(path.join(location, report.npmLogs[0]), 'utf8');
  expect(log).toContain('ETIMEDOUT');
  expect(log + JSON.stringify(report)).not.toContain('private-value');
  if (process.platform !== 'win32') {
    expect((await fs.stat(location)).mode & 0o777).toBe(0o700);
    expect((await fs.stat(path.join(location, 'report.json'))).mode & 0o777).toBe(0o600);
  }
});

test('retains preparation evidence when candidate verification fails and rolls back without retrying', async () => {
  const { service, probe, store } = setup();
  npmPreparation(false);
  probe.mockRejectedValue(new Error('handshake timed out'));

  await service.install('test-agent');

  expect(probe).toHaveBeenCalledOnce();
  expect(mocks.execFile).toHaveBeenCalledOnce();
  expect(store.get('test-agent')?.installedVersion).toBe('1.0.0');
  expect(await fs.readdir(path.join(home, 'provider-npx-cache'))).toEqual([]);
  const [{ report }] = await reports();
  expect(report).toMatchObject({ failedStage: 'connecting', npmLogs: ['npm-1.log'] });
});

test('diagnostic storage failures do not mask the installation error or prevent rollback', async () => {
  const { service, store } = setup();
  npmPreparation(true);
  await fs.writeFile(path.join(home, 'diagnostics'), 'not a directory');

  await expect(service.install('test-agent')).rejects.toThrow('npm failed');
  expect(store.get('test-agent')?.installedVersion).toBe('1.0.0');
  expect(await fs.readdir(path.join(home, 'provider-npx-cache'))).toEqual([]);
});

test('a first uvx installation is not marked installed when package preparation fails', async () => {
  const { service, store, probe } = setup('uvx');
  store.delete('test-agent');
  mocks.execFile.mockImplementation(
    (_command: string, _args: string[], _options: unknown, callback: (error: Error) => void) =>
      callback(Object.assign(new Error('uv download failed'), { stderr: 'ETIMEDOUT' })),
  );

  await expect(service.install('test-agent')).rejects.toThrow('uv download failed');
  expect(probe).not.toHaveBeenCalled();
  expect(store.get('test-agent')).toMatchObject({ installState: 'failed', installedVersion: null });
  expect(mocks.execFile).toHaveBeenCalledOnce();
});

test('verification rollback never deletes an externally configured package cache', async () => {
  const { service, probe } = setup();
  const external = path.join(home, 'user-owned-cache');
  await fs.mkdir(external);
  await fs.writeFile(path.join(external, 'keep'), 'external installation');
  vi.spyOn(ProviderLauncher.prototype, 'prepareLaunch').mockImplementation(async (_id, launch) => ({
    ...launch,
    env: { ...launch.env, npm_config_cache: external },
  }));
  probe.mockRejectedValue(new Error('provider internal error'));
  await service.install('test-agent', { prewarmNpx: false });
  expect(await fs.readFile(path.join(external, 'keep'), 'utf8')).toBe('external installation');
});
