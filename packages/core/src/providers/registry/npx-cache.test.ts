import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, expect, test, vi } from 'vite-plus/test';
import type { AgentDriver } from '../../agent/types.js';
import { createDatabase } from '../../db/index.js';
import { ProviderStore } from './provider-store.js';
import { ProviderLauncher } from './provider-launcher.js';
import { BinaryInstaller } from './binary-installer.js';
import { isNpxPackagePrepared } from './npx-cache.js';

const mocks = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  execFile: mocks.execFile,
}));

let home: string;
const spec = '@scope/agent@1.0.0';
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'npx-recovery-'));
  vi.stubEnv('AGENTCTL_HOME', home);
  mocks.execFile.mockReset();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(home, { recursive: true, force: true });
});

async function completedTree(cache: string) {
  const tree = path.join(cache, '_npx', 'fixture');
  const pkg = path.join(tree, 'node_modules', '@scope', 'agent');
  await fs.mkdir(pkg, { recursive: true });
  await fs.mkdir(path.join(tree, 'node_modules', '.bin'), { recursive: true });
  await fs.writeFile(
    path.join(tree, 'package.json'),
    JSON.stringify({ _npx: { packages: [spec] } }),
  );
  await fs.writeFile(path.join(tree, 'package-lock.json'), '{}');
  await fs.writeFile(
    path.join(pkg, 'package.json'),
    JSON.stringify({ name: '@scope/agent', version: '1.0.0', bin: { agent: 'index.js' } }),
  );
  await fs.writeFile(path.join(pkg, 'index.js'), '', { mode: 0o755 });
  await fs.writeFile(
    path.join(tree, 'node_modules', '.bin', 'agent' + (process.platform === 'win32' ? '.cmd' : '')),
    '',
    { mode: 0o755 },
  );
  return tree;
}

function fixture() {
  const store = new ProviderStore(createDatabase(':memory:'));
  const cache = path.join(home, 'old-cache');
  store.upsert('agent', {
    name: 'Agent',
    command: 'npx',
    launchArgs: JSON.stringify(['-y', spec]),
    launchEnv: JSON.stringify({ npm_config_cache: cache, KEEP_ENV: 'yes' }),
    installSource: 'npx',
    installState: 'system_available',
    installedVersion: '1.0.0',
    authState: 'authenticated',
    customEnv: JSON.stringify({ API_TOKEN: 'credential-ref' }),
    version: '2.0.0',
  });
  const launcher = new ProviderLauncher(store, new BinaryInstaller(), {
    resolveEnvSync: () => ({ API_TOKEN: 'private-token' }),
  });
  const launch = launcher.resolveLaunch(store.get('agent')!);
  return { store, cache, launcher, launch };
}

function successfulPreparation(gate: Promise<void> = Promise.resolve()) {
  mocks.execFile.mockImplementation(
    (
      _cmd: string,
      _args: string[],
      options: { env: NodeJS.ProcessEnv },
      callback: (error: Error | null) => void,
    ) => {
      void gate
        .then(() => completedTree(options.env.npm_config_cache!))
        .then(
          () => callback(null),
          (e: Error) => callback(e),
        );
    },
  );
}

test('rebuilds the incomplete tree from the reported ENOENT before starting the connection check', async () => {
  const { store, cache, launcher, launch } = fixture();
  await fs.mkdir(path.join(cache, '_npx', 'partial', 'node_modules', '@scope', 'agent'), {
    recursive: true,
  });
  const inspectProvider = vi.fn(async (_cmd, _args, env) => {
    expect(await isNpxPackagePrepared(env.npm_config_cache, spec)).toBe(true);
    return {
      status: 'ready',
      configOptions: [],
      authMethods: [],
      supportsDynamicModel: false,
      supportsDynamicConfig: false,
    };
  });
  successfulPreparation();
  await launcher.inspectLaunch(
    'agent',
    { inspectProvider } as unknown as AgentDriver,
    launch,
    '1.0.0',
  );
  expect(inspectProvider).toHaveBeenCalledOnce();
  expect(mocks.execFile).toHaveBeenCalledOnce();
  expect(mocks.execFile.mock.calls[0][1]).toContain(`--package=${spec}`);
  expect(mocks.execFile.mock.calls[0][2].timeout).toBe(600_000);
  const saved = store.get('agent')!;
  expect(saved.installedVersion).toBe('1.0.0');
  expect(saved.authState).toBe('authenticated');
  expect(saved.customEnv).toContain('credential-ref');
  expect(saved.launchEnv).not.toContain('private-token');
  expect(JSON.parse(saved.launchEnv!).KEEP_ENV).toBe('yes');
  expect(JSON.parse(saved.launchEnv!).npm_config_cache).not.toBe(cache);
  expect(await fs.stat(cache)).toBeDefined();
});

test('healthy caches require no npm process and concurrent recovery is coalesced', async () => {
  const { launcher, launch, store } = fixture();
  let release!: () => void;
  successfulPreparation(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  const first = launcher.prepareLaunch('agent', launch);
  const second = launcher.prepareLaunch('agent', launch);
  await vi.waitFor(() => expect(mocks.execFile).toHaveBeenCalledOnce());
  release();
  expect((await first).env.npm_config_cache).toBe((await second).env.npm_config_cache);
  await launcher.prepareLaunch('agent', launcher.resolveLaunch(store.get('agent')!));
  expect(mocks.execFile).toHaveBeenCalledOnce();
});

test('persists repaired legacy launch metadata so later probes reuse the prepared cache', async () => {
  const { launcher, store } = fixture();
  store.update('agent', { launchArgs: '[]' });
  const launch = launcher.resolveLaunch(store.get('agent')!, {
    id: 'agent',
    name: 'Agent',
    version: '2.0.0',
    description: '',
    authors: [],
    distribution: { npx: { package: '@scope/agent', args: [], env: {} } },
  });
  successfulPreparation();
  await launcher.prepareLaunch('agent', launch);
  expect(JSON.parse(store.get('agent')!.launchArgs!)).toEqual(['-y', spec]);
  await launcher.prepareLaunch('agent', launcher.resolveLaunch(store.get('agent')!));
  expect(mocks.execFile).toHaveBeenCalledOnce();
});

test('rejects a cache whose actual package version differs from the pinned version', async () => {
  const cache = path.join(home, 'cache');
  const tree = await completedTree(cache);
  const manifest = path.join(tree, 'node_modules', '@scope', 'agent', 'package.json');
  const pkg = JSON.parse(await fs.readFile(manifest, 'utf8'));
  await fs.writeFile(manifest, JSON.stringify({ ...pkg, version: '2.0.0' }));
  expect(await isNpxPackagePrepared(cache, spec)).toBe(false);
});

test.each(['package.json', 'package-lock.json', 'node_modules/.bin/agent'])(
  'rejects an installed tree missing %s',
  async (missing) => {
    const cache = path.join(home, 'cache');
    const tree = await completedTree(cache);
    const relative =
      missing === 'node_modules/.bin/agent' && process.platform === 'win32'
        ? `${missing}.cmd`
        : missing;
    await fs.rm(path.join(tree, relative));
    expect(await isNpxPackagePrepared(cache, spec)).toBe(false);
  },
);

test('failed preparation preserves its logs, leaves the old pointer intact and never starts ACP', async () => {
  const { launcher, launch, store, cache } = fixture();
  mocks.execFile.mockImplementation(
    (
      _cmd: string,
      _args: string[],
      options: { env: NodeJS.ProcessEnv },
      callback: (error: Error | null) => void,
    ) => {
      const fail = async () => {
        const logDir = path.join(options.env.npm_config_cache!, '_logs');
        await fs.mkdir(logDir, { recursive: true });
        await fs.writeFile(path.join(logDir, 'debug.log'), 'ETIMEDOUT');
        callback(new Error('download timed out'));
      };
      void fail();
    },
  );
  const inspectProvider = vi.fn();
  await expect(
    launcher.inspectLaunch('agent', { inspectProvider } as unknown as AgentDriver, launch, '1.0.0'),
  ).rejects.toThrow('download timed out');
  expect(inspectProvider).not.toHaveBeenCalled();
  expect(mocks.execFile).toHaveBeenCalledOnce();
  expect(JSON.parse(store.get('agent')!.launchEnv!).npm_config_cache).toBe(cache);
  expect(await fs.readdir(path.join(home, 'provider-npx-cache'))).toEqual([]);
  const reports = path.join(home, 'diagnostics', 'providers');
  const records = await Promise.all(
    (await fs.readdir(reports)).map(async (p) =>
      JSON.parse(await fs.readFile(path.join(reports, p, 'report.json'), 'utf8')),
    ),
  );
  expect(records.some((r) => r.operation === 'package-preparation' && r.npmLogs.length === 1)).toBe(
    true,
  );
});

test('shutdown aborts preparation without publishing a replacement cache', async () => {
  const { launcher, launch, store, cache } = fixture();
  mocks.execFile.mockImplementation(
    (
      _cmd: string,
      _args: string[],
      options: { signal: AbortSignal },
      callback: (error: Error | null) => void,
    ) => {
      options.signal.addEventListener('abort', () => callback(new Error('cancelled')), {
        once: true,
      });
    },
  );
  const pending = launcher.prepareLaunch('agent', launch);
  const rejected = expect(pending).rejects.toThrow('cancelled');
  await vi.waitFor(() => expect(mocks.execFile).toHaveBeenCalledOnce());
  await launcher.dispose();
  await rejected;
  expect(JSON.parse(store.get('agent')!.launchEnv!).npm_config_cache).toBe(cache);
});
