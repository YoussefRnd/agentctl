import type { RegistryAgent } from '@agentctl/shared';
import type { ProviderStore } from './provider-store.js';
import type { ProviderLauncher } from './provider-launcher.js';
import type { createAgentConnection } from '../acp-transport.js';

type CreateConnection = typeof createAgentConnection;

export class AuthProvider {
  constructor(
    private launcher: ProviderLauncher,
    private store: ProviderStore,
  ) {}

  async login(
    providerId: string,
    agent: RegistryAgent | undefined,
    methodId: string,
    params: Record<string, unknown>,
    createConnection: CreateConnection,
  ) {
    const provider = this.store.get(providerId);
    if (!provider) throw new Error('Provider not found');

    const launch = this.launcher.resolveLaunch(provider, agent);
    const { child, connection } = createConnection(launch.command, launch.args, launch.env);

    try {
      await connection.initialize({
        protocolVersion: 1,
        clientInfo: { name: 'agentctl-login', title: 'Agentctl', version: '1.0.0' },
      });
      await connection.authenticate({ methodId, _meta: params });
      this.store.setAuthState(providerId, 'authenticated');
      this.store.setEnabled(providerId, true);
      this.launcher.invalidateProbe(providerId);
    } finally {
      child.kill();
    }
  }

  async logout(
    providerId: string,
    agent: RegistryAgent | undefined,
    createConnection: CreateConnection,
  ) {
    const provider = this.store.get(providerId);
    if (!provider) throw new Error('Provider not found');

    const launch = this.launcher.resolveLaunch(provider, agent);
    const { child, connection } = createConnection(launch.command, launch.args, launch.env);

    try {
      await connection.initialize({
        protocolVersion: 1,
        clientInfo: { name: 'agentctl-logout', title: 'Agentctl', version: '1.0.0' },
      });
      if (typeof connection.logout === 'function') {
        await connection.logout({});
      } else if (typeof connection.sendRequest === 'function') {
        await connection.sendRequest('logout', {});
      }
      this.launcher.invalidateProbe(providerId);
      this.store.setAuthState(providerId, 'needs_auth');
    } finally {
      child.kill();
    }
  }
}
