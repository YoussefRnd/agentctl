import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { beforeEach, afterEach, expect, test, vi } from 'vite-plus/test';
import { createDatabase } from '../../db/index.js';
import type { AgentDriver } from '../../agent/types.js';
import type { RegistryAgent } from '@agentctl/shared';
import { ProviderStore } from './provider-store.js';
import { ProviderLauncher } from './provider-launcher.js';
import { BinaryInstaller, getPlatformKey } from './binary-installer.js';
import * as uvx from './uvx-cache.js';

let home: string;
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'universal-provider-preparation-'));
  vi.stubEnv('AGENTCTL_HOME', home);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await fs.rm(home, { recursive: true, force: true });
});

function setup(command: string, source: 'system' | 'managed' | 'uvx', args: string[] = []) {
  const store = new ProviderStore(createDatabase(':memory:'));
  store.upsert('generic-agent', {
    name: 'Generic',
    command,
    launchArgs: JSON.stringify(args),
    installState: source === 'managed' ? 'installed_local' : 'system_available',
    installSource: source,
    installedVersion: '1.0.0',
    version: '1.0.0',
    authState: 'authenticated',
    launchEnv: JSON.stringify({ KEEP: 'yes' }),
    customEnv: JSON.stringify({ API_TOKEN: 'secret-reference' }),
  });
  const installer = new BinaryInstaller();
  const launcher = new ProviderLauncher(store, installer, {
    resolveEnvSync: () => ({ API_TOKEN: 'private-credential' }),
  });
  return {
    store,
    installer,
    launcher,
    launch: () => launcher.resolveLaunch(store.get('generic-agent')!),
  };
}

test('validates system executables without reinstalling on an unrelated ACP failure', async () => {
  const fixture = setup(process.execPath, 'system');
  const install = vi.spyOn(fixture.installer, 'install');
  const inspectProvider = vi.fn().mockRejectedValue(new Error('provider internal error'));
  await expect(
    fixture.launcher.inspectLaunch(
      'generic-agent',
      { inspectProvider } as unknown as AgentDriver,
      fixture.launch(),
    ),
  ).rejects.toThrow('provider internal error');
  expect(inspectProvider).toHaveBeenCalledOnce();
  expect(install).not.toHaveBeenCalled();
});

test('rejects missing external executables before spawning ACP and preserves credentials', async () => {
  const fixture = setup(path.join(home, 'missing-command'), 'system');
  const inspectProvider = vi.fn();
  await expect(
    fixture.launcher.inspectLaunch(
      'generic-agent',
      { inspectProvider } as unknown as AgentDriver,
      fixture.launch(),
    ),
  ).rejects.toMatchObject({ code: 'EXECUTABLE_NOT_FOUND' });
  expect(inspectProvider).not.toHaveBeenCalled();
  expect(fixture.store.get('generic-agent')?.authState).toBe('authenticated');
});

test('repairs managed archives using their pinned receipt even when the catalog advances', async () => {
  const source = path.join(home, 'source');
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'generic-agent'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const archive = path.join(home, 'agent.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', source, 'generic-agent']);
  const bytes = await fs.readFile(archive);
  const target = {
    archive: 'https://example.com/generic-1.0.0.tar.gz',
    cmd: 'generic-agent',
    env: {},
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
  const agent: RegistryAgent = {
    id: 'generic-agent',
    name: 'Generic',
    version: '1.0.0',
    description: '',
    authors: [],
    distribution: { binary: { [getPlatformKey()]: target } },
  };
  const installer = new BinaryInstaller();
  const command = path.join(
    installer.getVersionedInstallDir(agent.id, agent.version, target.archive),
    target.cmd,
  );
  const fixture = setup(command, 'managed', ['acp']);
  fixture.store.update(agent.id, {
    distribution: JSON.stringify(agent.distribution),
    version: '2.0.0',
  });
  // The complete tree is activated atomically and a receipt is written last.
  const fetch = vi.fn().mockImplementation(async () => new Response(bytes));
  vi.stubGlobal('fetch', fetch);
  await fixture.installer.install(agent, getPlatformKey());
  expect(await fixture.installer.readReceipt(agent.id, command)).toMatchObject({
    version: '1.0.0',
  });
  await fs.writeFile(command, 'truncated');
  expect(await fixture.installer.isPreparedCommand(agent.id, command)).toBe(false);
  const repaired = await fixture.launcher.prepareLaunch(agent.id, fixture.launch());
  expect(await fs.readFile(repaired.command, 'utf8')).toBe('#!/bin/sh\nexit 0\n');
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1][0]).toBe(target.archive);
  expect(fixture.store.get(agent.id)).toMatchObject({
    installedVersion: '1.0.0',
    version: '2.0.0',
    authState: 'authenticated',
  });
  expect(repaired.args).toEqual(['acp']);
});

async function writeUvxTool(spec: string, root: string) {
  const tool = path.join(root, 'tools', 'generic-tool');
  const command = path.join(
    root,
    'bin',
    'generic-tool' + (process.platform === 'win32' ? '.exe' : ''),
  );
  await fs.mkdir(path.dirname(command), { recursive: true });
  await fs.mkdir(path.join(tool, process.platform === 'win32' ? 'Scripts' : 'bin'), {
    recursive: true,
  });
  await fs.writeFile(command, 'complete tool', { mode: 0o755 });
  await fs.writeFile(path.join(tool, 'uv-receipt.toml'), 'complete');
  await fs.writeFile(path.join(tool, 'pyvenv.cfg'), 'complete');
  await fs.writeFile(
    path.join(tool, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'),
    'python',
  );
  const stat = await fs.stat(command);
  await fs.writeFile(
    path.join(root, 'ready.json'),
    JSON.stringify({
      spec,
      executable: path.relative(root, command),
      tool: path.relative(root, tool),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    }),
  );
  return command;
}

test('prepares uvx tools before ACP, persists only safe metadata and repairs damaged environments', async () => {
  const fixture = setup('uvx', 'uvx', ['generic-tool==1.0.0', 'acp']);
  const install = vi.spyOn(uvx, 'prepareUvxPackage').mockImplementation(writeUvxTool);
  const first = await fixture.launcher.prepareLaunch('generic-agent', fixture.launch());
  expect(first.command).not.toBe('uvx');
  expect(first.args).toEqual(['acp']);
  expect(await uvx.preparedUvxCommand(first.env.AGENTCTL_UVX_ROOT, 'generic-tool==1.0.0')).toBe(
    first.command,
  );
  expect(fixture.store.get('generic-agent')?.launchEnv).not.toContain('private-credential');
  await fixture.launcher.prepareLaunch('generic-agent', fixture.launch());
  expect(install).toHaveBeenCalledOnce();
  await fs.rm(path.join(first.env.UV_TOOL_DIR, 'generic-tool', 'pyvenv.cfg'));
  const second = await fixture.launcher.prepareLaunch('generic-agent', fixture.launch());
  expect(second.env.AGENTCTL_UVX_ROOT).not.toBe(first.env.AGENTCTL_UVX_ROOT);
  expect(install).toHaveBeenCalledTimes(2);
  expect(fixture.store.get('generic-agent')?.authState).toBe('authenticated');
});

test('uvx preparation failures preserve CLI logs and never mark the candidate installed', async () => {
  const fixture = setup('uvx', 'uvx', ['generic-tool==1.0.0', 'acp']);
  vi.spyOn(uvx, 'prepareUvxPackage').mockRejectedValue(
    Object.assign(new Error('download failed'), {
      stderr: 'connect ETIMEDOUT private-credential',
    }),
  );
  const inspectProvider = vi.fn();
  await expect(
    fixture.launcher.inspectLaunch(
      'generic-agent',
      { inspectProvider } as unknown as AgentDriver,
      fixture.launch(),
    ),
  ).rejects.toThrow('download failed');
  expect(inspectProvider).not.toHaveBeenCalled();
  expect(fixture.store.get('generic-agent')?.command).toBe('uvx');
  const root = path.join(home, 'diagnostics', 'providers');
  const logs = [];
  for (const folder of await fs.readdir(root)) {
    const log = path.join(root, folder, 'process-stderr.log');
    try {
      logs.push(await fs.readFile(log, 'utf8'));
    } catch {
      /* Other diagnostic records may not have CLI output. */
    }
  }
  expect(logs.length).toBeGreaterThan(0);
  expect(logs.join()).toContain('ETIMEDOUT');
  expect(logs.join()).not.toContain('private-credential');
  expect(await fs.readdir(path.join(home, 'provider-uvx-cache'))).toEqual([]);
});
