import type { RegistryAgent } from '@agentctl/shared';
import type { AgentDriver } from '../../agent/types.js';
import type { ProviderLauncher } from './provider-launcher.js';
import type { ProviderStore } from './provider-store.js';
import { jsonCodecs } from '../../db/json-codecs.js';

export class AuthProvider {
  constructor(
    private launcher: ProviderLauncher,
    private store: ProviderStore,
    private runtime: AgentDriver,
  ) {}

  async login(
    providerId: string,
    agent: RegistryAgent | undefined,
    methodId: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    const row = this.store.get(providerId);
    if (!row) throw new Error(`Provider ${providerId} not found`);

    if (methodId === 'env') {
      const existing = jsonCodecs.stringRecord(row.customEnv);
      const nextCustomEnv = { ...existing };
      for (const [k, v] of Object.entries(params)) {
        if (typeof v === 'string') nextCustomEnv[k] = v;
      }
      this.store.setCustomEnv(providerId, nextCustomEnv);
      this.store.setAuthState(providerId, 'authenticated');
      this.launcher.invalidateProbe(providerId, this.runtime, agent);
      return;
    }

    const initialAuthState = row.authState;

    const launch = this.launcher.resolveLaunch(row, agent);
    try {
      if (!this.runtime.authenticateProvider) {
        throw new Error('Agent adapter does not support authentication');
      }
      await this.runtime.authenticateProvider(
        launch.command,
        launch.args,
        launch.env,
        methodId,
        params,
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      this.store.setAuthState(providerId, 'authenticated');
      this.launcher.invalidateProbe(providerId, this.runtime, agent);
    } catch (err) {
      this.store.setAuthState(providerId, initialAuthState);
      throw err;
    }
  }

  async logout(providerId: string, agent: RegistryAgent | undefined): Promise<void> {
    const row = this.store.get(providerId);
    if (!row) throw new Error(`Provider ${providerId} not found`);

    this.store.setCustomEnv(providerId, {});

    const launch = this.launcher.resolveLaunch(row, agent);
    try {
      await this.runtime.logoutProvider?.(launch.command, launch.args, launch.env);
    } catch {
      // Ignore errors on logout
    }
    this.store.setAuthState(providerId, 'needs_auth');
    this.launcher.invalidateProbe(providerId, this.runtime, agent);
  }
}
