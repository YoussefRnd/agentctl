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
    const authParams = Object.keys(params).length > 0 ? { methodId, _meta: params } : { methodId };

    if (this.connectionManager) {
      try {
        const persistent = await this.connectionManager.getConnection(providerId);
        await persistent.connection.authenticate(authParams);
        await new Promise((resolve) => setTimeout(resolve, 500));
        this.store.setAuthState(providerId, 'authenticated');
        this.launcher.invalidateProbe(providerId);

        try {
          const sessionResult = await persistent.connection.newSession({
            cwd: os.tmpdir(),
            mcpServers: [],
          });
          if (sessionResult.sessionId && persistent.supportsCloseSession) {
            void persistent.connection
              .closeSession({ sessionId: sessionResult.sessionId })
              .catch(() => undefined);
          }
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
      await connection.authenticate(authParams);
      await new Promise((resolve) => setTimeout(resolve, 500));
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
        try {
          await persistent.connection.logout({});
        } catch {
          // Logout may be unsupported by the agent; nothing further to attempt
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
    const connection = connRes.connection;

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
