import os from 'node:os';
import type { RegistryAgent } from '@agentctl/shared';
import type { ProviderLauncher } from './provider-launcher.js';
import type { ProviderStore } from './provider-store.js';
import type { PersistentAgentConnectionManager } from './persistent-connection.js';
import type { ACPConnectionHandle } from '../../acp/types.js';
import { extractConfigOptionsFromSessionResult } from '../../acp/runtime.js';

export type ConnectionCreator = (
  command: string,
  args: string[],
  env: Record<string, string>,
) => ACPConnectionHandle;

export class AuthProvider {
  constructor(
    private launcher: ProviderLauncher,
    private store: ProviderStore,
    private connectionManager?: PersistentAgentConnectionManager,
  ) {}

  async login(
    providerId: string,
    agent: RegistryAgent | undefined,
    methodId: string,
    params: Record<string, unknown>,
    createConnection: ConnectionCreator,
  ): Promise<void> {
    const row = this.store.get(providerId);
    if (!row) throw new Error(`Provider ${providerId} not found`);

    if (methodId === 'env') {
      const existing = JSON.parse(row.customEnv || '{}') as Record<string, string>;
      const nextCustomEnv = { ...existing };
      for (const [k, v] of Object.entries(params)) {
        if (typeof v === 'string') nextCustomEnv[k] = v;
      }
      this.store.setCustomEnv(providerId, nextCustomEnv);
      this.store.setAuthState(providerId, 'authenticated');
      this.launcher.invalidateProbe(providerId);
      return;
    }

    const initialAuthState = row.authState;
    const authParams: Record<string, unknown> = { methodId };
    if (Object.keys(params).length > 0) {
      authParams._meta = params;
    }

    if (this.connectionManager) {
      try {
        const persistent = await this.connectionManager.getConnection(providerId);
        const connWithAuth = persistent.connection as unknown as {
          authenticate?: (p: unknown) => Promise<unknown>;
          newSession?: (p: unknown) => Promise<unknown>;
        };
        if (typeof connWithAuth.authenticate === 'function') {
          await connWithAuth.authenticate(authParams);
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        this.store.setAuthState(providerId, 'authenticated');
        this.launcher.invalidateProbe(providerId);

        if (typeof connWithAuth.newSession === 'function') {
          try {
            const sessionResult = (await connWithAuth.newSession({
              cwd: os.tmpdir(),
              mcpServers: [],
            })) as Parameters<typeof extractConfigOptionsFromSessionResult>[0];
            const configOptions = extractConfigOptionsFromSessionResult(sessionResult);
            if (configOptions.length > 0) {
              this.store.update(providerId, {
                configOptions: JSON.stringify(configOptions),
                supportsDynamicModel: configOptions.some(
                  (opt) => opt.id === 'model' || opt.id === 'selectedModel',
                ),
                supportsDynamicConfig: true,
              });
            }
          } catch {
            // Ignore error extracting sessionResult post-login
          }
        }
        return;
      } catch (err) {
        this.store.setAuthState(providerId, initialAuthState);
        throw err;
      }
    }

    const launch = this.launcher.resolveLaunch(row, agent);
    const connRes = createConnection(launch.command, launch.args, launch.env);
    const child = connRes.child;
    const connection = connRes.connection;

    try {
      if (typeof connection.initialize === 'function') {
        await connection.initialize({
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: { name: 'agentctl-login', title: 'Agentctl', version: '1.0.0' },
        });
      }
      const connWithAuth = connection as unknown as {
        authenticate?: (p: unknown) => Promise<unknown>;
      };
      if (typeof connWithAuth.authenticate === 'function') {
        await connWithAuth.authenticate(authParams);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      this.store.setAuthState(providerId, 'authenticated');
      this.launcher.invalidateProbe(providerId);
    } catch (err) {
      this.store.setAuthState(providerId, initialAuthState);
      throw err;
    } finally {
      if (typeof child.kill === 'function') {
        child.kill();
      }
    }
  }

  async logout(
    providerId: string,
    agent: RegistryAgent | undefined,
    createConnection: ConnectionCreator,
  ): Promise<void> {
    const row = this.store.get(providerId);
    if (!row) throw new Error(`Provider ${providerId} not found`);

    this.store.setCustomEnv(providerId, {});

    if (this.connectionManager) {
      try {
        const persistent = await this.connectionManager.getConnection(providerId);
        const connWithLogout = persistent.connection as unknown as {
          logout?: (p: unknown) => Promise<unknown>;
          sendRequest?: (m: string, p: unknown) => Promise<unknown>;
        };
        if (typeof connWithLogout.logout === 'function') {
          await connWithLogout.logout({});
        } else if (typeof connWithLogout.sendRequest === 'function') {
          await connWithLogout.sendRequest('logout', {});
        }
      } catch {
        // Ignore logout errors
      } finally {
        this.connectionManager.closeConnection(providerId);
      }
      this.store.setAuthState(providerId, 'needs_auth');
      this.launcher.invalidateProbe(providerId);
      return;
    }

    const launch = this.launcher.resolveLaunch(row, agent);
    const connRes = createConnection(launch.command, launch.args, launch.env);
    const child = connRes.child;
    const connection = connRes.connection as unknown as {
      initialize?: (p: unknown) => Promise<unknown>;
      logout?: (p: unknown) => Promise<unknown>;
      sendRequest?: (m: string, p: unknown) => Promise<unknown>;
    };

    try {
      if (typeof connection.initialize === 'function') {
        await connection.initialize({
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: { name: 'agentctl-logout', title: 'Agentctl', version: '1.0.0' },
        });
      }
      if (typeof connection.logout === 'function') {
        await connection.logout({});
      } else if (typeof connection.sendRequest === 'function') {
        await connection.sendRequest('logout', {});
      }
    } catch {
      // Ignore errors on logout
    } finally {
      if (typeof child.kill === 'function') {
        child.kill();
      }
    }
    this.store.setAuthState(providerId, 'needs_auth');
    this.launcher.invalidateProbe(providerId);
  }
}
