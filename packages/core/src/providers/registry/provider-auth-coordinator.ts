import type { AuthError, AuthMethod, RegistryAgent } from '@agentctl/shared';
import type { AgentDriver } from '../../agent/types.js';
import type { ProviderLauncher } from './provider-launcher.js';
import type { ProviderStore } from './provider-store.js';
import type { RegistryFetcher } from './registry-fetcher.js';
import type { AgentConnectionManager } from '../../acp/types.js';
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
  connectionManager: AgentConnectionManager;
  logger?: Logger;
  onStateChange?: () => void;
}

export class ProviderAuthCoordinator {
  private store: ProviderStore;
  private launcher: ProviderLauncher;
  private runtime: AgentDriver;
  private fetcher: RegistryFetcher;
  private connectionManager: AgentConnectionManager;
  private logger: Logger;
  private onStateChange: () => void;

  // Mutex per provider to serialize operations
  private activeOperations = new Map<string, Promise<unknown>>();
  // Active abort controllers per provider
  private abortControllers = new Map<string, AbortController>();

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
    const prev = this.activeOperations.get(providerId) ?? Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(async () => {
        return op();
      })
      .finally(() => {
        if (this.activeOperations.get(providerId) === next) {
          this.activeOperations.delete(providerId);
        }
      });

    this.activeOperations.set(providerId, next);
    return next;
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
        const found = agents.find((a) => a.id === providerId);
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

      // 3. Mark authenticating
      const abortController = new AbortController();
      this.abortControllers.set(providerId, abortController);
      const externalSignal = options?.signal;
      const abortFromExternalSignal = () =>
        abortController.abort(new Error('Authentication cancelled'));
      if (externalSignal?.aborted) abortFromExternalSignal();
      else externalSignal?.addEventListener('abort', abortFromExternalSignal, { once: true });

      this.store.setAuthDetails(providerId, {
        authState: 'authenticating',
        connectionState: 'checking',
        authError: null,
      });
      this.notify();

      const timeoutMs = options?.timeoutMs ?? 120_000;

      try {
        const launch = this.launcher.resolveLaunch(row, agent);
        if (!this.runtime.authenticateProvider) {
          throw new Error('Agent adapter does not support authentication');
        }
        abortController.signal.throwIfAborted();

        const authPromise = this.runtime.authenticateProvider(
          launch.command,
          launch.args,
          launch.env,
          methodId,
          { signal: abortController.signal, timeoutMs },
        );
        const abortPromise = new Promise<never>((_, reject) => {
          abortController.signal.addEventListener(
            'abort',
            () =>
              reject(
                abortController.signal.reason instanceof Error
                  ? abortController.signal.reason
                  : new Error('Authentication cancelled'),
              ),
            { once: true },
          );
        });
        const timeout = setTimeout(
          () => abortController.abort(new Error(`Authentication timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
        try {
          await Promise.race([authPromise, abortPromise]);
        } finally {
          clearTimeout(timeout);
        }

        // 4. Verification probe before declaring success
        this.store.setAuthDetails(providerId, {
          authState: 'verifying',
          connectionState: 'checking',
        });
        this.notify();

        await this.verify(providerId);
      } catch (err: unknown) {
        const current = this.store.get(providerId);
        if (current?.authState === 'required') throw err;
        const message = err instanceof Error ? err.message : String(err);
        const isCancelled = message.toLowerCase().includes('cancelled');
        const isTimeout = message.toLowerCase().includes('timed out');
        const authError: AuthError = {
          code: isCancelled ? 'AUTH_CANCELLED' : isTimeout ? 'AUTH_TIMEOUT' : 'AUTH_FAILED',
          message,
          retryable: true,
        };

        this.store.setAuthDetails(providerId, {
          authState: isCancelled ? 'required' : 'error',
          connectionState: isCancelled ? 'ready' : 'error',
          authError: JSON.stringify(authError),
        });
        this.notify();
        throw err;
      } finally {
        externalSignal?.removeEventListener('abort', abortFromExternalSignal);
        this.abortControllers.delete(providerId);
      }
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

      const abortController = new AbortController();
      this.abortControllers.set(providerId, abortController);
      const externalSignal = options?.signal;
      const abortFromExternalSignal = () =>
        abortController.abort(new Error('Terminal authentication cancelled'));
      if (externalSignal?.aborted) abortFromExternalSignal();
      else externalSignal?.addEventListener('abort', abortFromExternalSignal, { once: true });

      this.store.setAuthDetails(providerId, {
        authState: 'authenticating',
        connectionState: 'checking',
        authError: null,
      });
      this.notify();

      try {
        const baseLaunch = this.launcher.resolveLaunch(row, agent);
        const terminalArgs = [...baseLaunch.args, ...(targetMethod.args ?? [])];
        const terminalEnv = { ...baseLaunch.env, ...targetMethod.env };
        if (abortController.signal.aborted) throw new Error('Terminal authentication cancelled');
        const commandPromise = executeCommand(
          baseLaunch.command,
          terminalArgs,
          terminalEnv,
          abortController.signal,
        );
        const abortPromise = new Promise<never>((_, reject) => {
          abortController.signal.addEventListener(
            'abort',
            () =>
              reject(
                abortController.signal.reason instanceof Error
                  ? abortController.signal.reason
                  : new Error('Terminal authentication cancelled'),
              ),
            { once: true },
          );
        });
        const timeoutMs = options?.timeoutMs ?? 10 * 60_000;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            const error = new Error(`Terminal authentication timed out after ${timeoutMs}ms`);
            abortController.abort(error);
            reject(error);
          }, timeoutMs);
        });
        let exitCode: number;
        try {
          ({ exitCode } = await Promise.race([commandPromise, abortPromise, timeoutPromise]));
        } finally {
          if (timeout) clearTimeout(timeout);
        }

        if (exitCode !== 0) {
          throw new Error(`Terminal authentication process exited with non-zero code ${exitCode}`);
        }

        // Verify probe
        this.store.setAuthDetails(providerId, {
          authState: 'verifying',
          connectionState: 'checking',
        });
        this.notify();

        await this.verify(providerId);
      } catch (err: unknown) {
        const current = this.store.get(providerId);
        if (current?.authState === 'required') throw err;
        const message = err instanceof Error ? err.message : String(err);
        const isCancelled = message.toLowerCase().includes('cancelled');
        const isTimeout = message.toLowerCase().includes('timed out');
        const authError: AuthError = {
          code: isCancelled
            ? 'AUTH_CANCELLED'
            : isTimeout
              ? 'AUTH_TIMEOUT'
              : 'TERMINAL_AUTH_FAILED',
          message,
          retryable: true,
        };

        this.store.setAuthDetails(providerId, {
          authState: isCancelled ? 'required' : 'error',
          connectionState: isCancelled ? 'ready' : 'error',
          authError: JSON.stringify(authError),
        });
        this.notify();
        throw err;
      } finally {
        externalSignal?.removeEventListener('abort', abortFromExternalSignal);
        if (this.abortControllers.get(providerId) === abortController) {
          this.abortControllers.delete(providerId);
        }
      }
    });
  }

  async verify(providerId: string): Promise<void> {
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
    const controller = this.abortControllers.get(providerId);
    if (controller) {
      controller.abort(new Error('Authentication cancelled'));
      this.abortControllers.delete(providerId);
    }
    const row = this.store.get(providerId);
    if (row && (row.authState === 'authenticating' || row.authState === 'verifying')) {
      this.store.setAuthDetails(providerId, {
        authState: 'required',
        connectionState: 'ready',
      });
      this.notify();
    }
  }

  dispose(): void {
    for (const providerId of Array.from(this.abortControllers.keys())) {
      this.cancelLogin(providerId);
    }
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
