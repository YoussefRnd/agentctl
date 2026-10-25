import { describe, expect, test, vi } from 'vite-plus/test';
import type { RegistryAgent } from '@agentctl/shared';
import type { AgentDriver } from '../../agent/types.js';
import { createDatabase } from '../../db/index.js';
import { providers } from '../../db/schema.js';
import { BinaryInstaller } from './binary-installer.js';
import {
  ProviderLauncher,
  resolveNpxPackageSpec,
  resolveUvxPackageSpec,
} from './provider-launcher.js';
import { ProviderStore } from './provider-store.js';

describe('ProviderLauncher', () => {
  test('evicts rejected probes instead of caching a sticky failure', async () => {
    const db = createDatabase(':memory:');
    db.insert(providers)
      .values({
        id: 'retry-agent',
        name: 'Retry Agent',
        command: 'retry-agent',
        installState: 'system_available',
        installSource: 'system',
        authState: 'unknown',
      })
      .run();
    const launcher = new ProviderLauncher(new ProviderStore(db), new BinaryInstaller());
    vi.spyOn(launcher, 'prepareLaunch').mockImplementation(async (_id, launch) => launch);
    const inspectProvider = vi.fn().mockRejectedValue(new Error('temporary transport failure'));
    const runtime = { inspectProvider } as unknown as AgentDriver;
    const agent: RegistryAgent = {
      id: 'retry-agent',
      name: 'Retry Agent',
      version: '1.0.0',
      description: '',
      authors: [],
      distribution: {},
    };

    await expect(launcher.probe(agent.id, runtime, agent)).rejects.toThrow(
      'temporary transport failure',
    );
    await expect(launcher.probe(agent.id, runtime, agent)).rejects.toThrow(
      'temporary transport failure',
    );

    expect(inspectProvider).toHaveBeenCalledTimes(2);
  });

  test('pins plain uvx packages while preserving explicit specifications', () => {
    expect(resolveUvxPackageSpec('agent-pkg', '1.2.3')).toBe('agent-pkg==1.2.3');
    expect(resolveUvxPackageSpec('agent-pkg==2.0.0', '1.2.3')).toBe('agent-pkg==2.0.0');
    expect(resolveUvxPackageSpec('agent-pkg@2.0.0', '1.2.3')).toBe('agent-pkg==2.0.0');
  });

  test('keeps persisted package-runner args pinned when registry metadata advances', () => {
    const db = createDatabase(':memory:');
    const store = new ProviderStore(db);
    store.upsert('pinned-agent', {
      name: 'Pinned Agent',
      command: 'npx',
      launchArgs: JSON.stringify(['-y', 'pinned-agent@1.0.0', 'acp']),
      launchEnv: JSON.stringify({ FROM_INSTALL: 'yes' }),
      installState: 'system_available',
      installSource: 'npx',
      installedVersion: '1.0.0',
      authState: 'authenticated',
    });
    const launcher = new ProviderLauncher(store, new BinaryInstaller());
    const launch = launcher.resolveBaseLaunch(store.get('pinned-agent')!, {
      id: 'pinned-agent',
      name: 'Pinned Agent',
      version: '2.0.0',
      description: '',
      authors: [],
      distribution: {
        npx: { package: 'pinned-agent', args: ['new-arg'], env: { FROM_REGISTRY: 'yes' } },
      },
    });

    expect(launch).toEqual({
      command: 'npx',
      args: ['-y', 'pinned-agent@1.0.0', 'acp'],
      env: { FROM_INSTALL: 'yes' },
    });
    expect(resolveNpxPackageSpec('@scope/agent', '1.2.3')).toBe('@scope/agent@1.2.3');
  });
});
