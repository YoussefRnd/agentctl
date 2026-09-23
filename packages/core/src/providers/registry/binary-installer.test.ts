import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RegistryAgent } from '@agentctl/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BinaryInstaller } from './binary-installer.js';

const originalAgentctlHome = process.env.AGENTCTL_HOME;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalAgentctlHome === undefined) delete process.env.AGENTCTL_HOME;
  else process.env.AGENTCTL_HOME = originalAgentctlHome;
});

describe('BinaryInstaller installation checks', () => {
  it('rejects provider ids that can escape the managed install root', () => {
    const installer = new BinaryInstaller();
    expect(() => installer.getInstallDir('../escape')).toThrow(/safe path segment/);
    expect(() => installer.getInstallDir('/absolute')).toThrow(/safe path segment/);
  });

  it('rejects stale versions when the current registry executable is missing', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-binary-installer-'));
    process.env.AGENTCTL_HOME = home;
    const installer = new BinaryInstaller();
    const agent: RegistryAgent = {
      id: 'opencode',
      name: 'OpenCode',
      version: '2.0.0',
      description: '',
      authors: [],
      distribution: {
        binary: {
          'linux-x86_64': {
            archive: 'https://example.com/opencode.tar.gz',
            cmd: './opencode',
            args: ['acp'],
            env: {},
          },
        },
      },
    };

    const staleDirectory = path.join(installer.getInstallDir(agent.id), 'v_stale');
    await fs.mkdir(staleDirectory, { recursive: true });
    await fs.writeFile(path.join(staleDirectory, 'opencode'), 'stale');

    expect(installer.isInstalled(agent.id)).toBe(true);
    expect(installer.isInstalled(agent.id, agent, 'linux-x86_64')).toBe(false);

    const currentDirectory = installer.getVersionedInstallDir(
      agent.id,
      agent.version,
      agent.distribution.binary?.['linux-x86_64']?.archive ?? '',
    );
    const currentBinary = path.join(currentDirectory, 'opencode');
    await fs.mkdir(currentDirectory, { recursive: true });
    await fs.writeFile(currentBinary, 'current', { mode: 0o755 });
    await fs.chmod(currentBinary, 0o755);

    expect(installer.isInstalled(agent.id, agent, 'linux-x86_64')).toBe(true);
    await fs.rm(home, { recursive: true, force: true });
  });

  it('keeps the previous version when verification of an update fails', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-binary-rollback-'));
    process.env.AGENTCTL_HOME = home;
    const installer = new BinaryInstaller();
    const previousDir = path.join(installer.getInstallDir('safe-agent'), 'v_previous');
    const previousBinary = path.join(previousDir, 'safe-agent');
    await fs.mkdir(previousDir, { recursive: true });
    await fs.writeFile(previousBinary, 'working', { mode: 0o755 });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(Buffer.from('corrupt archive'), {
          status: 200,
          headers: { 'content-length': '15' },
        }),
      ),
    );

    await expect(
      installer.install(
        {
          id: 'safe-agent',
          name: 'Safe Agent',
          version: '2.0.0',
          description: '',
          authors: [],
          distribution: {
            binary: {
              'linux-x86_64': {
                archive: 'https://example.com/safe-agent.tar.gz',
                cmd: 'safe-agent',
                env: {},
                sha256: '0'.repeat(64),
              },
            },
          },
        },
        'linux-x86_64',
      ),
    ).rejects.toThrow(/Checksum mismatch/);

    await expect(fs.readFile(previousBinary, 'utf8')).resolves.toBe('working');
    await fs.rm(home, { recursive: true, force: true });
  });

  it('removes only staging directories belonging to the exact provider id', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-staging-scope-'));
    process.env.AGENTCTL_HOME = home;
    const installer = new BinaryInstaller();
    const stagingRoot = path.join(home, 'staging');
    const own = path.join(stagingRoot, 'foo-123456-abc123');
    const other = path.join(stagingRoot, 'foo-bar-123456-abc123');
    await fs.mkdir(own, { recursive: true });
    await fs.mkdir(other, { recursive: true });

    await installer.removeStaging('foo');

    await expect(fs.stat(own)).rejects.toThrow();
    await expect(fs.stat(other)).resolves.toBeDefined();
    await fs.rm(home, { recursive: true, force: true });
  });
});
