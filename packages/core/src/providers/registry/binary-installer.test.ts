import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RegistryAgent } from '@agentctl/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { BinaryInstaller } from './binary-installer.js';

const originalAgentctlHome = process.env.AGENTCTL_HOME;

afterEach(() => {
  if (originalAgentctlHome === undefined) delete process.env.AGENTCTL_HOME;
  else process.env.AGENTCTL_HOME = originalAgentctlHome;
});

describe('BinaryInstaller installation checks', () => {
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
});
