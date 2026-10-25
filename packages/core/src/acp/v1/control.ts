import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type ClientCapabilities,
  type InitializeResponse,
} from '@agentclientprotocol/sdk';
import { createCapabilitySnapshot, findAgentConfigOption } from '@agentctl/shared';
import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import type {
  AgentAuthenticationOptions,
  AgentConfigOption,
  AgentDescriptor,
  AgentInspectionOptions,
} from '../../agent/types.js';
import { applicationInfo } from '../../config/application-info.js';
import { OperationDiagnostics } from '../../agent/operation-diagnostics.js';
import {
  DEFAULT_PROVIDER_AUTH_TIMEOUT_MS,
  getAgentRequestTimeoutMs,
} from '../../config/runtime-defaults.js';
import type { Logger } from '../../logger.js';
import { getCacheKey } from '../cache/launch-identity.js';
import { FileCacheStorage } from '../cache/provider-descriptor.js';
import { projectAuthMethods } from '../protocol/auth-methods.js';
import { respondToBrowserAuthentication } from '../protocol/browser-auth.js';
import { isAcpAuthenticationRequired } from '../protocol/error-classifier.js';
import { cleanEnv, spawnManagedProcess, withTimeout } from '../transport/acp-process-lifecycle.js';
import { initializeAcpConnection } from './capabilities.js';
import { agentConnectionFacade, type AcpAgentConnection } from '../transport/client-connection.js';
import {
  ACP_SESSION_CLOSE_TIMEOUT_MS,
  ACP_SESSION_OPERATION_TIMEOUT_MS,
} from '../transport/limits.js';
import { withProcessDiagnostics } from '../transport/stderr.js';
import type { AcpParsedCapabilities, AgentStreamTransport, CacheStorage } from '../types.js';
import { extractConfigOptionsFromSessionResult } from './configuration.js';

/** Restricted provider operations share one deadline and one authoritative teardown path. */
export class AcpV1ProviderControls {
  private readonly cache: CacheStorage;
  constructor(
    private spawnImpl: typeof spawn,
    private logger: Logger,
    private createTransport: (child: ChildProcess, logger: Logger) => AgentStreamTransport,
    cache?: CacheStorage,
  ) {
    this.cache =
      cache ??
      new FileCacheStorage(path.join(os.homedir(), '.agentctl', 'capabilities-manifest.json'));
  }

  private async withConnection<T>(
    command: string,
    args: string[],
    env: Record<string, string> | undefined,
    name: string,
    operation: (
      connection: AcpAgentConnection,
      initialization: InitializeResponse,
      capabilities: AcpParsedCapabilities,
      trace: OperationDiagnostics,
    ) => Promise<T>,
    options: AgentAuthenticationOptions & { inspect?: boolean; auth?: boolean } = {},
  ): Promise<T> {
    const trace = new OperationDiagnostics(name, this.logger, { adapter: 'v1' });
    trace.stage('spawning');
    const { child, transport } = (() => {
      try {
        return spawnManagedProcess({
          command,
          args,
          env,
          cwd: os.tmpdir(),
          spawnImpl: this.spawnImpl,
          logger: this.logger,
          createTransport: this.createTransport,
        });
      } catch (error) {
        trace.fail(error);
        throw error;
      }
    })();
    void transport.closed.catch(() => undefined);
    const abort = () => transport.kill();
    options.signal?.addEventListener('abort', abort, { once: true });
    const app = client({ name })
      .onNotification(methods.client.session.update, () => undefined)
      .onRequest(methods.client.session.requestPermission, () => ({
        outcome: { outcome: 'cancelled' },
      }));
    if (options.auth)
      app.onRequest(methods.client.elicitation.create, ({ params, signal }) =>
        respondToBrowserAuthentication(params, signal, options),
      );
    const connection = agentConnectionFacade(
      app.connect(ndJsonStream(transport.stdin, transport.stdout)),
    );
    const capabilities: ClientCapabilities = {
      ...((options.auth || options.inspect) && process.platform !== 'win32'
        ? { auth: { terminal: true } }
        : {}),
      ...(options.inspect ? { session: { configOptions: { boolean: {} } } } : {}),
      ...(options.auth ? { elicitation: { url: {} } } : {}),
    };
    try {
      options.signal?.throwIfAborted();
      trace.stage('initializing');
      const result = await withTimeout(
        (async () => {
          const initialized = await initializeAcpConnection(connection, {
            transport,
            clientInfo: applicationInfo(name),
            clientCapabilities: capabilities,
          });
          if (name !== 'agentctl-probe') trace.stage('operation');
          return operation(
            connection,
            initialized.initResult,
            initialized.parsedCapabilities,
            trace,
          );
        })(),
        options.timeoutMs ?? ACP_SESSION_OPERATION_TIMEOUT_MS,
        `performing ${name} operation`,
      );
      trace.finish('success');
      return result;
    } catch (error) {
      trace.fail(error);
      throw withProcessDiagnostics(error, child);
    } finally {
      options.signal?.removeEventListener('abort', abort);
      connection.close?.();
      transport.kill();
    }
  }

  async inspectProvider(
    command: string,
    args: string[],
    env?: Record<string, string>,
    options?: AgentInspectionOptions,
  ): Promise<AgentDescriptor> {
    const identity = {
      providerVersion: options?.providerVersion,
      protocolVersion: String(PROTOCOL_VERSION),
    };
    const key = getCacheKey(command, args, cleanEnv(env), identity);
    const cached = await this.cache.get(key).catch(() => null);
    if (cached) return cached;
    const result = await this.withConnection(
      command,
      args,
      env,
      'agentctl-probe',
      async (connection, init, capabilities, trace) => {
        let configOptions: AgentConfigOption[] = [];
        let modes: string[] | undefined;
        let status: AgentDescriptor['status'] = 'ready';
        try {
          trace.stage('opening-session');
          const session = await connection.newSession({ cwd: os.tmpdir(), mcpServers: [] });
          configOptions = extractConfigOptionsFromSessionResult(session);
          modes = session.modes?.availableModes.map((mode) => mode.id);
          if (capabilities.supportsCloseSession) {
            trace.stage('closing-session');
            await withTimeout(
              connection.closeSession({ sessionId: session.sessionId }),
              ACP_SESSION_CLOSE_TIMEOUT_MS,
              'closing provider probe',
            ).catch(() => undefined);
          }
        } catch (error) {
          if (!isAcpAuthenticationRequired(error)) throw error;
          status = 'needs_auth';
          const data = (error as { data?: { configOptions?: AgentConfigOption[] } }).data;
          configOptions = data?.configOptions ?? [];
        }
        const supportsDynamicModel = !!findAgentConfigOption(configOptions, 'model');
        const supportsDynamicConfig = configOptions.length > 0;
        const supportsLogout = !!init.agentCapabilities?.auth?.logout;
        const descriptor: AgentDescriptor = {
          status,
          configOptions,
          modes,
          supportsDynamicModel,
          supportsDynamicConfig,
          supportsLogout,
          authMethods: projectAuthMethods(init.authMethods ?? [], 1),
          features: {
            sessions: {
              resume: capabilities.supportsResumeSession || capabilities.supportsLoadSession,
              fork: capabilities.supportsForkSession,
              delete: capabilities.supportsDeleteSession,
              list: capabilities.supportsListSessions,
            },
            prompts: {
              image: capabilities.supportsImage,
              audio: capabilities.supportsAudio,
              embeddedContext: capabilities.supportsEmbeddedContext,
            },
            configuration: { model: supportsDynamicModel, options: supportsDynamicConfig },
            authentication: { logout: supportsLogout },
          },
        };
        descriptor.snapshot = createCapabilitySnapshot(descriptor.features!, 'handshake', {
          ...identity,
          commandHash: key,
        });
        return descriptor;
      },
      { inspect: true, timeoutMs: getAgentRequestTimeoutMs() },
    ).catch((error: unknown): AgentDescriptor => {
      if (!isAcpAuthenticationRequired(error)) throw error;
      return {
        status: 'needs_auth',
        configOptions: [],
        authMethods: [],
        supportsDynamicModel: false,
        supportsDynamicConfig: false,
        supportsLogout: false,
      };
    });
    if (result.status === 'ready') await this.cache.set(key, result).catch(() => undefined);
    return result;
  }

  listSessions(
    command: string,
    args: string[],
    env: Record<string, string> | undefined,
    params: { cwd?: string; cursor?: string },
  ) {
    return this.withConnection(
      command,
      args,
      env,
      'agentctl-list',
      async (connection, _init, capabilities) => {
        if (!capabilities.supportsListSessions)
          throw new Error('Agent does not support native session listing');
        const result = await connection.listSessions(params);
        return { sessions: result.sessions, nextCursor: result.nextCursor ?? undefined };
      },
    );
  }
  deleteSession(
    command: string,
    args: string[],
    env: Record<string, string> | undefined,
    sessionId: string,
  ): Promise<void> {
    return this.withConnection(
      command,
      args,
      env,
      'agentctl-delete',
      async (connection, _init, capabilities) => {
        if (capabilities.supportsDeleteSession) await connection.deleteSession({ sessionId });
      },
    );
  }
  invalidateProviderCache(
    command: string,
    args: string[],
    env?: Record<string, string>,
    options?: AgentInspectionOptions,
  ): Promise<void> {
    return (
      this.cache.delete?.(
        getCacheKey(command, args, cleanEnv(env), {
          providerVersion: options?.providerVersion,
          protocolVersion: String(PROTOCOL_VERSION),
        }),
      ) ?? Promise.resolve()
    );
  }
  authenticateProvider(
    command: string,
    args: string[],
    env: Record<string, string> | undefined,
    methodId: string,
    options: AgentAuthenticationOptions = {},
  ): Promise<void> {
    return this.withConnection(
      command,
      args,
      env,
      'agentctl-login',
      async (connection, init) => {
        const method = init.authMethods?.find((entry) => entry.id === methodId);
        if (!method)
          throw new Error(`Authentication method '${methodId}' was not advertised by the agent`);
        if ('type' in method && method.type === 'terminal')
          throw new Error(
            `Cannot pass terminal authentication method '${methodId}' to authenticate. Terminal authentication must be run in an interactive terminal.`,
          );
        await connection.authenticate({ methodId });
      },
      { ...options, auth: true, timeoutMs: options.timeoutMs ?? DEFAULT_PROVIDER_AUTH_TIMEOUT_MS },
    );
  }
  logoutProvider(command: string, args: string[], env?: Record<string, string>): Promise<void> {
    return this.withConnection(command, args, env, 'agentctl-logout', async (connection, init) => {
      if (!init.agentCapabilities?.auth?.logout)
        throw new Error(
          'Agent does not advertise logout capability (agentCapabilities.auth.logout)',
        );
      await connection.logout({});
    });
  }
}
