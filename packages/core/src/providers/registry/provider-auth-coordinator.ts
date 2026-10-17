import { ProviderAuthOperations } from './provider-auth-operations.js';
import {
  DEFAULT_PROVIDER_AUTH_TIMEOUT_MS,
  DEFAULT_TERMINAL_AUTH_TIMEOUT_MS,
} from '../../config/runtime-defaults.js';
import { randomUUID } from 'node:crypto';
import type { AuthError, AuthMethod, RegistryAgent } from '@agentctl/shared';
import type { AgentDriver } from '../../agent/types.js';
import type { ProviderLauncher } from './provider-launcher.js';
import type { ProviderStore } from './provider-store.js';
import type { RegistryFetcher } from './registry-fetcher.js';
import type { AgentConnectionLifecycle } from '../../agent/connection-lifecycle.js';
import { type Logger, noopLogger } from '../../logger.js';
import { parseRegistryAgents } from './registry-parser.js';
import { jsonCodecs } from '../../db/json-codecs.js';
import { isAgentAuthenticationRequiredError } from '../../agent/errors.js';
import { Provider } from '../provider.js';

export interface ProviderAuthCoordinatorOptions {
  store: ProviderStore;
  launcher: ProviderLauncher;
  runtime: AgentDriver;
  fetcher: RegistryFetcher;
  connectionManager: AgentConnectionLifecycle;
  logger?: Logger;
  onStateChange?: () => void;
}

export class ProviderAuthCoordinator {
  private store: ProviderStore;
  private launcher: ProviderLauncher;
  private runtime: AgentDriver;
  private fetcher: RegistryFetcher;
  private connectionManager: AgentConnectionLifecycle;
  private logger: Logger;
  private onStateChange: () => void;

  private browserInteractions = new Map<
    string,
    { request: { id: string; url: string; message: string }; resolve: (accepted: boolean) => void }
  >();
  private credentialsChanging?: (providerIds: string[]) => Promise<void>;

  setCredentialChangeHandler(handler: (providerIds: string[]) => Promise<void>): void {
    this.credentialsChanging = handler;
  }
  async waitForCredentialOperation(providerId: string): Promise<void> {
    const key = this.store.get(providerId)?.registryAgentId ?? providerId;
    await this.operations.wait(key);
  }
  getAuthInteraction(providerId: string) {
    return this.browserInteractions.get(providerId)?.request;
  }
  respondAuthInteraction(providerId: string, id: string, accepted: boolean): boolean {
    const pending = this.browserInteractions.get(providerId);
    if (!pending || pending.request.id !== id) return false;
    this.browserInteractions.delete(providerId);
    pending.resolve(accepted);
    this.notify();
    return true;
  }
  private requestBrowser(
    providerId: string,
    request: { id: string; url: string; message: string },
    signal: AbortSignal,
  ): Promise<boolean> {
    signal.throwIfAborted();
    request = { ...request, id: randomUUID() };
    if (this.browserInteractions.has(providerId))
      throw new Error('A browser authentication request is already pending');
    return new Promise<boolean>((resolve) => {
      const abort = () => this.respondAuthInteraction(providerId, request.id, false);
      this.browserInteractions.set(providerId, {
        request,
        resolve: (accepted) => {
          signal.removeEventListener('abort', abort);
          resolve(accepted);
        },
      });
      signal.addEventListener('abort', abort, { once: true });
      this.notify();
    });
  }
  private async invalidateCredentialPeers(providerId: string, signal?: AbortSignal): Promise<void> {
    const row = this.store.get(providerId)!;
    const agentId = row.registryAgentId ?? row.id;
    const peers = this.store
      .listAll()
      .filter((item) => (item.registryAgentId ?? item.id) === agentId);
    await this.credentialsChanging?.(peers.map((item) => item.id));
    signal?.throwIfAborted();
    for (const peer of peers) {
      this.connectionManager.closeConnection(peer.id);
      this.launcher.invalidateProbe(peer.id, this.runtime, this.getRegistryAgent(peer.id));
      if (peer.id !== providerId)
        this.store.setAuthDetails(peer.id, {
          authState: 'unknown',
          connectionState: 'unknown',
          authError: null,
          lastVerifiedAt: null,
        });
    }
    this.notify();
  }

  private readonly operations = new ProviderAuthOperations();

  constructor(options: ProviderAuthCoordinatorOptions) {
    this.store = options.store;
    this.launcher = options.launcher;
    this.runtime = options.runtime;
    this.fetcher = options.fetcher;
    this.connectionManager = options.connectionManager;
    this.logger = options.logger ?? noopLogger;
    this.onStateChange = options.onStateChange ?? (() => undefined);
  }

  private serialize<T>(providerId: string, op: () => Promise<T>): Promise<T> {
    const key = this.store.get(providerId)?.registryAgentId ?? providerId;
    return this.operations.serialize(key, op);
  }

  private notify(): void {
    try {
      this.onStateChange();
    } catch (err) {
      this.logger.error(err, 'Failed to trigger onStateChange in ProviderAuthCoordinator');
    }
  }

  private getRegistryAgent(providerId: string): RegistryAgent | undefined {
    const snapshot = this.fetcher.getSnapshot();
    if (snapshot) {
      try {
        const agents = parseRegistryAgents(snapshot.data);
        const found = agents.find(
          (a) => a.id === (this.store.get(providerId)?.registryAgentId ?? providerId),
        );
        if (found) return found;
      } catch (error) {
        this.logger.warn({ error }, 'Ignoring invalid provider registry snapshot during auth');
      }
    }
    const row = this.store.get(providerId);
    if (row) {
      return new Provider(row).toDiscovery().agent;
    }
    return undefined;
  }

  getAdvertisedAuthMethods(providerId: string): AuthMethod[] {
    const row = this.store.get(providerId);
    if (!row) return [];

    const rowMethods = jsonCodecs.authMethods(row.authMethods);
    if (rowMethods.length > 0) return rowMethods;

    const agent = this.getRegistryAgent(providerId);
    return agent?.authMethods ?? [];
  }

  async login(
    providerId: string,
    methodId: string,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<void> {
    return this.serialize(providerId, async () => {
      const row = this.store.get(providerId);
      if (!row) throw new Error(`Provider ${providerId} not found`);

      // 1. Invalidate persistent connection and ongoing probes
      this.connectionManager.closeConnection(providerId);
      const agent = this.getRegistryAgent(providerId);
      this.launcher.invalidateProbe(providerId, this.runtime, agent);

      // 2. Validate method was advertised
      const advertisedMethods = this.getAdvertisedAuthMethods(providerId);
      const targetMethod = advertisedMethods.find((m) => m.id === methodId);

      if (!targetMethod) {
        throw new Error(
          `Authentication method '${methodId}' was not advertised by provider ${providerId}`,
        );
      }

      if (targetMethod.type === 'terminal') {
        throw new Error(
          `Cannot use agent authenticate RPC with terminal authentication method '${methodId}'. Terminal authentication must run in an interactive terminal.`,
        );
      }
      if (targetMethod.type === 'env_var') {
        throw new Error(
          `Authentication method '${methodId}' uses environment credentials and cannot be passed to the ACP authenticate RPC.`,
        );
      }

      await this.runAuthentication(
        providerId,
        options?.timeoutMs ?? DEFAULT_PROVIDER_AUTH_TIMEOUT_MS,
        options?.signal,
        'AUTH_FAILED',
        async (signal, timeoutMs) => {
          const launch = this.launcher.resolveLaunch(row, agent);
          if (!this.runtime.authenticateProvider)
            throw new Error('Agent adapter does not support authentication');
          await this.runtime.authenticateProvider(
            launch.command,
            launch.args,
            launch.env,
            methodId,
            {
              signal,
              timeoutMs,
              onBrowserRequest: (request) => this.requestBrowser(providerId, request, signal),
            },
          );
        },
      );
    });
  }

  async runTerminalAuth(
    providerId: string,
    methodId: string,
    executeCommand: (
      command: string,
      args: string[],
      env: Record<string, string>,
      signal: AbortSignal,
    ) => Promise<{ exitCode: number }>,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<void> {
    return this.serialize(providerId, async () => {
      const row = this.store.get(providerId);
      if (!row) throw new Error(`Provider ${providerId} not found`);

      this.connectionManager.closeConnection(providerId);
      const agent = this.getRegistryAgent(providerId);
      this.launcher.invalidateProbe(providerId, this.runtime, agent);

      const advertisedMethods = this.getAdvertisedAuthMethods(providerId);
      const targetMethod = advertisedMethods.find((m) => m.id === methodId);

      if (!targetMethod || targetMethod.type !== 'terminal') {
        throw new Error(
          `Terminal authentication method '${methodId}' is not advertised by provider ${providerId}`,
        );
      }

      await this.runAuthentication(
        providerId,
        options?.timeoutMs ?? DEFAULT_TERMINAL_AUTH_TIMEOUT_MS,
        options?.signal,
        'TERMINAL_AUTH_FAILED',
        async (signal) => {
          const launch = this.launcher.resolveLaunch(row, agent);
          const { exitCode } = await executeCommand(
            launch.command,
            [...launch.args, ...(targetMethod.args ?? [])],
            { ...launch.env, ...targetMethod.env },
            signal,
          );
          if (exitCode !== 0)
            throw new Error(
              `Terminal authentication process exited with non-zero code ${exitCode}`,
            );
        },
      );
    });
  }

  private async runAuthentication(
    providerId: string,
    timeoutMs: number,
    externalSignal: AbortSignal | undefined,
    failureCode: string,
    authenticate: (signal: AbortSignal, timeoutMs: number) => Promise<void>,
  ): Promise<void> {
    const attempt = this.operations.begin(
      providerId,
      timeoutMs,
      externalSignal,
      this.store.get(providerId)?.registryAgentId ?? providerId,
    );
    try {
      await attempt.race(this.invalidateCredentialPeers(providerId, attempt.signal));
      attempt.signal.throwIfAborted();
      this.store.setAuthDetails(providerId, {
        authState: 'authenticating',
        connectionState: 'checking',
        authError: null,
      });
      this.notify();
      await attempt.race(authenticate(attempt.signal, timeoutMs));
      attempt.signal.throwIfAborted();
      await attempt.race(this.verify(providerId, attempt.signal));
    } catch (error) {
      if (this.store.get(providerId)?.authState === 'required') throw error;
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = message.toLowerCase().includes('cancelled');
      const timedOut = message.toLowerCase().includes('timed out');
      const authError: AuthError = {
        code: cancelled ? 'AUTH_CANCELLED' : timedOut ? 'AUTH_TIMEOUT' : failureCode,
        message,
        retryable: true,
      };
      this.store.setAuthDetails(providerId, {
        authState: cancelled ? 'required' : 'error',
        connectionState: cancelled ? 'ready' : 'error',
        authError: JSON.stringify(authError),
      });
      this.notify();
      throw error;
    } finally {
      const pending = this.browserInteractions.get(providerId);
      if (pending) this.respondAuthInteraction(providerId, pending.request.id, false);
      attempt.close();
    }
  }

  async verify(providerId: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const row = this.store.get(providerId);
    if (!row) throw new Error(`Provider ${providerId} not found`);
    const previousAuthState = row.authState === 'needs_auth' ? 'required' : row.authState;

    const agent = this.getRegistryAgent(providerId);
    if (!agent) throw new Error(`Provider ${providerId} has no agent configuration`);
    this.connectionManager.closeConnection(providerId);
    this.launcher.invalidateProbe(providerId, this.runtime, agent);
    this.store.setAuthDetails(providerId, {
      authState: 'verifying',
      connectionState: 'checking',
      authError: null,
    });
    this.notify();

    try {
      const probeResult = await this.launcher.probe(providerId, this.runtime, agent);
      signal?.throwIfAborted();

      if (probeResult.status === 'needs_auth') {
        const authError: AuthError = {
          code: 'AUTH_REQUIRED',
          message: 'Provider probe requires authentication',
          retryable: true,
        };
        this.store.setAuthDetails(providerId, {
          authState: 'required',
          connectionState: 'ready',
          authError: JSON.stringify(authError),
        });
        this.notify();
        throw new Error('Verification failed: credentials rejected by agent');
      }

      this.store.setAuthDetails(providerId, {
        authState: probeResult.authMethods.length > 0 ? 'authenticated' : 'not_required',
        connectionState: 'ready',
        authError: null,
        lastVerifiedAt: new Date(),
      });
      this.notify();
    } catch (err: unknown) {
      signal?.throwIfAborted();
      if (this.store.get(providerId)?.authState === 'required') throw err;
      if (isAgentAuthenticationRequiredError(err)) {
        const authError: AuthError = {
          code: 'AUTH_REQUIRED',
          message: 'Verification failed: authentication required',
          retryable: true,
        };
        this.store.setAuthDetails(providerId, {
          authState: 'required',
          connectionState: 'ready',
          authError: JSON.stringify(authError),
        });
        this.notify();
        throw err;
      }

      const message = err instanceof Error ? err.message : String(err);
      const authError: AuthError = {
        code: 'VERIFICATION_ERROR',
        message,
        retryable: true,
      };
      const restoredAuthState =
        previousAuthState === 'authenticated' ||
        previousAuthState === 'not_required' ||
        previousAuthState === 'required' ||
        previousAuthState === 'unknown'
          ? previousAuthState
          : 'unknown';
      this.store.setAuthDetails(providerId, {
        authState: restoredAuthState,
        connectionState: 'error',
        authError: JSON.stringify(authError),
      });
      this.notify();
      throw err;
    }
  }

  cancelLogin(providerId: string): void {
    const pending = this.browserInteractions.get(providerId);
    if (pending) this.respondAuthInteraction(providerId, pending.request.id, false);
    this.operations.cancel(providerId);
    const row = this.store.get(providerId);
    if (row && (row.authState === 'authenticating' || row.authState === 'verifying')) {
      this.store.setAuthDetails(providerId, {
        authState: 'required',
        connectionState: 'ready',
      });
      this.notify();
    }
  }

  dispose(): Promise<void> {
    for (const id of this.operations.activeProviderIds()) this.cancelLogin(id);
    return this.operations.dispose();
  }

  async logout(providerId: string): Promise<void> {
    return this.serialize(providerId, async () => {
      const row = this.store.get(providerId);
      if (!row) throw new Error(`Provider ${providerId} not found`);

      const agent = this.getRegistryAgent(providerId);
      this.connectionManager.closeConnection(providerId);

      // Validate logout capability
      const supportsLogout = row.supportsLogout || agent?.supportsLogout;

      if (!supportsLogout) {
        throw new Error(`Provider ${providerId} does not support logout`);
      }

      await this.invalidateCredentialPeers(providerId);

      try {
        const launch = this.launcher.resolveLaunch(row, agent);
        if (this.runtime.logoutProvider) {
          await this.runtime.logoutProvider(launch.command, launch.args, launch.env);
        }

        this.store.setAuthDetails(providerId, {
          authState: 'required',
          connectionState: 'unknown',
          authError: null,
          lastVerifiedAt: null,
        });
        this.launcher.invalidateProbe(providerId, this.runtime, agent);
        this.notify();
      } catch (err: unknown) {
        // Do NOT ignore errors! Preserve last verified state and report error
        const message = err instanceof Error ? err.message : String(err);
        const authError: AuthError = {
          code: 'LOGOUT_FAILED',
          message: `Logout failed: ${message}`,
          retryable: true,
        };
        this.store.setAuthDetails(providerId, {
          authError: JSON.stringify(authError),
        });
        this.notify();
        throw err;
      }
    });
  }

  markAuthRequired(providerId: string, error?: { code?: string; message?: string }): void {
    const authError: AuthError = {
      code: error?.code ?? 'AUTH_REQUIRED',
      message: error?.message ?? 'Authentication required by provider',
      retryable: true,
    };
    this.connectionManager.closeConnection(providerId);
    this.store.setAuthDetails(providerId, {
      authState: 'required',
      connectionState: 'ready',
      authError: JSON.stringify(authError),
    });
    const agent = this.getRegistryAgent(providerId);
    this.launcher.invalidateProbe(providerId, this.runtime, agent);
    this.notify();
  }
}
