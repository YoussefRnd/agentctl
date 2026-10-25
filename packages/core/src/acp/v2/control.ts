import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type ClientConnection,
  type InitializeResponse,
} from '@agentclientprotocol/sdk/experimental/v2';
import type { AgentConfigOption } from '@agentctl/shared';
import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import type {
  AgentAuthenticationOptions,
  AgentDescriptor,
  AgentInspectionOptions,
} from '../../agent/types.js';
import { applicationInfo } from '../../config/application-info.js';
import { OperationDiagnostics } from '../../agent/operation-diagnostics.js';
import {
  DEFAULT_PROVIDER_AUTH_TIMEOUT_MS,
  getAgentRequestTimeoutMs,
} from '../../config/runtime-defaults.js';
import { type Logger } from '../../logger.js';
import { respondToBrowserAuthentication } from '../protocol/browser-auth.js';
import { isAcpAuthenticationRequired } from '../protocol/error-classifier.js';
import { negotiateV2 } from '../protocol/negotiation.js';
import { spawnManagedProcess, withTimeout } from '../transport/acp-process-lifecycle.js';
import { withProcessDiagnostics } from '../transport/stderr.js';
import type { AgentStreamTransport } from '../types.js';
import { advertised, descriptorFromInitialization, productConfigOptions } from './capabilities.js';

export class AcpV2ProviderControls {
  constructor(
    private spawnImpl: typeof spawn,
    private logger: Logger,
    private createTransport: (child: ChildProcess, logger: Logger) => AgentStreamTransport,
  ) {}

  async inspectProvider(
    command: string,
    args: string[],
    env?: Record<string, string>,
    options?: AgentInspectionOptions,
  ): Promise<AgentDescriptor> {
    let initialization: InitializeResponse | undefined;
    try {
      return await this.withControlConnection(
        command,
        args,
        env,
        'agentctl-probe',
        async (connection, response, trace) => {
          initialization = response;
          let configOptions: AgentConfigOption[] = [];
          if (advertised(response.capabilities).sessions) {
            trace.stage('opening-session');
            const created = await withTimeout(
              connection.agent.request(methods.agent.session.new, {
                cwd: os.tmpdir(),
                mcpServers: [],
              }),
              getAgentRequestTimeoutMs(),
              'opening provider probe session',
            );
            configOptions = productConfigOptions(created.configOptions);
            trace.stage('closing-session');
            await connection.agent
              .request(methods.agent.session.close, { sessionId: created.sessionId })
              .catch(() => undefined);
          }
          return descriptorFromInitialization(response, configOptions, options);
        },
        { timeoutMs: getAgentRequestTimeoutMs(), browserAuth: false },
      );
    } catch (error) {
      if (!isAcpAuthenticationRequired(error)) throw error;
      return initialization
        ? { ...descriptorFromInitialization(initialization, [], options), status: 'needs_auth' }
        : {
            status: 'needs_auth',
            configOptions: [],
            authMethods: [],
            supportsDynamicModel: false,
            supportsDynamicConfig: false,
            supportsLogout: false,
          };
    }
  }

  async listSessions(
    command: string,
    args: string[],
    env: Record<string, string> | undefined,
    params: { cwd?: string; cursor?: string },
  ) {
    return this.withControlConnection(
      command,
      args,
      env,
      'agentctl-list',
      async (connection, initialization) => {
        if (!advertised(initialization.capabilities).sessions)
          throw new Error('Agent does not support native session listing');
        const page = await connection.agent.request(methods.agent.session.list, params);
        return { sessions: page.sessions, nextCursor: page.nextCursor ?? undefined };
      },
    );
  }

  async deleteSession(
    command: string,
    args: string[],
    env: Record<string, string> | undefined,
    agentSessionId: string,
  ): Promise<void> {
    await this.withControlConnection(
      command,
      args,
      env,
      'agentctl-delete',
      async (connection, initialization) => {
        if (advertised(initialization.capabilities).delete) {
          await connection.agent.request(methods.agent.session.delete, {
            sessionId: agentSessionId,
          });
        }
      },
    );
  }

  async authenticateProvider(
    command: string,
    args: string[],
    env: Record<string, string> | undefined,
    methodId: string,
    options: AgentAuthenticationOptions = {},
  ): Promise<void> {
    await this.withControlConnection(
      command,
      args,
      env,
      'agentctl-login',
      async (connection, initialization) => {
        const targetMethod = initialization.authMethods?.find(
          (m) => m.methodId === methodId || (m as { id?: string }).id === methodId,
        );
        if (!targetMethod) {
          throw new Error(`Authentication method '${methodId}' was not advertised by the agent`);
        }
        if (targetMethod?.type === 'terminal') {
          throw new Error(
            `Cannot pass terminal authentication method '${methodId}' to auth/login. Terminal authentication must be run in an interactive terminal.`,
          );
        }
        await connection.agent.request(methods.agent.auth.login, {
          methodId,
        });
      },
      options,
    );
  }

  async logoutProvider(
    command: string,
    args: string[],
    env?: Record<string, string>,
  ): Promise<void> {
    await this.withControlConnection(
      command,
      args,
      env,
      'agentctl-logout',
      async (connection, initialization) => {
        if (!initialization.authMethods || initialization.authMethods.length === 0) {
          throw new Error('Agent does not support logout: no auth methods advertised');
        }
        await connection.agent.request(methods.agent.auth.logout, {});
      },
    );
  }

  private async withControlConnection<T>(
    command: string,
    args: string[],
    env: Record<string, string> | undefined,
    name: string,
    operation: (
      connection: ClientConnection,
      initialization: InitializeResponse,
      trace: OperationDiagnostics,
    ) => Promise<T>,
    options: AgentAuthenticationOptions & { browserAuth?: boolean } = {},
  ): Promise<T> {
    const trace = new OperationDiagnostics(name, this.logger, { adapter: 'v2' });
    trace.stage('spawning');
    const managed = (() => {
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
    const { transport } = managed;
    // Control connections are intentionally killed after their operation finishes.
    void transport.closed.catch(() => undefined);
    const abort = () => transport.kill('SIGTERM');
    options.signal?.addEventListener('abort', abort, { once: true });
    const app = client({ name });
    app.onNotification(methods.client.session.update, () => undefined);
    app.onRequest(methods.client.session.requestPermission, () => ({
      outcome: { outcome: 'cancelled' },
    }));
    const browserAuth = options.browserAuth !== false;
    if (browserAuth)
      app.onRequest(methods.client.elicitation.create, ({ params, signal }) =>
        respondToBrowserAuthentication(params, signal, options),
      );
    const connection = app.connect(ndJsonStream(transport.stdin, transport.stdout));
    try {
      if (options.signal?.aborted) throw new Error('Authentication cancelled');
      trace.stage('initializing');
      const initialization = await withTimeout(
        negotiateV2(
          connection.agent.request(methods.agent.initialize, {
            protocolVersion: PROTOCOL_VERSION,
            info: applicationInfo(name),
            capabilities: {
              ...(process.platform === 'win32' ? {} : { auth: { terminal: {} } }),
              ...(browserAuth ? { elicitation: { url: {} } } : {}),
            },
          }),
        ),
        options.timeoutMs ?? DEFAULT_PROVIDER_AUTH_TIMEOUT_MS,
        'initializing provider control connection',
      );
      if (name !== 'agentctl-probe') trace.stage('operation');
      const result = await withTimeout(
        operation(connection, initialization, trace),
        options.timeoutMs ?? DEFAULT_PROVIDER_AUTH_TIMEOUT_MS,
        'performing provider control operation',
      );
      trace.finish('success');
      return result;
    } catch (error) {
      trace.fail(error);
      throw withProcessDiagnostics(error, managed.child);
    } finally {
      options.signal?.removeEventListener('abort', abort);
      connection.close();
      transport.kill();
    }
  }
}
