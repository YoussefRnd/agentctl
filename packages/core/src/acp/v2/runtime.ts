import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type AgentCapabilities,
  type ClientConnection,
  type ContentBlock,
  type InitializeResponse,
  type NewSessionRequest,
  type RequestPermissionRequest,
  type SessionConfigOption,
  type UpdateSessionNotification,
} from '@agentclientprotocol/sdk/experimental/v2';
import type { ACPConfigOption } from '@agentctl/shared';
import type {
  AgentDescriptor,
  AgentDriver,
  AgentPermissionRequest,
  AgentSession,
  AgentSessionCallbacks,
  AgentSessionOptions,
  AgentStopReason,
  AgentUsage,
} from '../../agent/types.js';
import { AgentAuthenticationRequiredError, AgentError } from '../../agent/errors.js';
import { type Logger, noopLogger } from '../../logger.js';
import type { AgentStreamTransport } from '../types.js';
import { ProcessStreamTransport, cleanEnv } from '../transport/process-transport.js';
import { buildPromptBlocks } from '../protocol/prompt.js';
import { normalizeAcpUsage } from '../protocol/usage.js';
import { getAgentRequestTimeoutMs } from '../../config/runtime-defaults.js';
import { withTimeout } from '../transport/capabilities-cache.js';
import { projectV2ConfigOption, projectV2SessionUpdate } from './events.js';

interface TurnStop {
  stopReason: AgentStopReason;
  usage?: AgentUsage;
}

interface ActiveCallbacks {
  callbacks: AgentSessionCallbacks;
  stops: TurnStop[];
  waiters: Array<{ resolve(value: TurnStop): void; reject(error: unknown): void }>;
}

function isAuthError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { code?: unknown; message?: unknown };
  const code = String(value.code ?? '').toLowerCase();
  const message = String(value.message ?? '').toLowerCase();
  return (
    code === 'auth_required' ||
    code === 'needs_auth' ||
    message.includes('auth_required') ||
    message.includes('authentication required') ||
    message.includes('unauthorized')
  );
}

function errorCode(error: unknown): unknown {
  return error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
}

function isSessionNotFound(error: unknown): boolean {
  if (errorCode(error) === -32002) return true;
  const message =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message).toLowerCase()
      : '';
  return (
    message.includes('session') &&
    (message.includes('not found') || message.includes('does not exist'))
  );
}

function productConfigOptions(options?: SessionConfigOption[]): ACPConfigOption[] {
  return (options ?? [])
    .map(projectV2ConfigOption)
    .filter((option): option is ACPConfigOption => option !== null);
}

function descriptorFromInitialization(
  initialization: InitializeResponse,
  configOptions: ACPConfigOption[],
): AgentDescriptor {
  const authMethods = (initialization.authMethods ?? [])
    .filter((method) => method.type === 'agent')
    .map((method) => ({
      id: method.methodId,
      name: method.name,
      type: 'agent' as const,
      description: method.description ?? null,
    }));
  const modes = configOptions
    .filter((option) => option.category === 'mode' || option.id === 'mode')
    .flatMap((option) => option.options?.map((entry) => entry.value) ?? []);
  return {
    status: 'ready',
    configOptions,
    authMethods,
    supportsDynamicModel: configOptions.some(
      (option) => option.category === 'model' || option.id === 'model',
    ),
    supportsDynamicConfig: configOptions.length > 0,
    supportsLogout: authMethods.length > 0,
    modes,
  };
}

function toPermissionRequest(
  request: RequestPermissionRequest,
  permissionId: string,
): AgentPermissionRequest {
  const subject = request.subject;
  if (subject?.type === 'tool_call' && 'toolCall' in subject) {
    const call = subject.toolCall as {
      name?: unknown;
      title?: unknown;
      rawInput?: unknown;
      toolCallId?: unknown;
    };
    return {
      permissionId,
      description: request.description ?? request.title,
      toolCall: {
        name:
          typeof call.name === 'string'
            ? call.name
            : typeof call.title === 'string'
              ? call.title
              : request.title,
        arguments:
          call.rawInput && typeof call.rawInput === 'object' && !Array.isArray(call.rawInput)
            ? (call.rawInput as Record<string, unknown>)
            : undefined,
        toolCallId: typeof call.toolCallId === 'string' ? call.toolCallId : undefined,
      },
      options: request.options.map((option) => ({
        optionId: option.optionId,
        label: option.name,
        kind:
          option.kind === 'allow_once' ||
          option.kind === 'allow_always' ||
          option.kind === 'reject_once' ||
          option.kind === 'reject_always'
            ? option.kind
            : undefined,
      })),
    };
  }
  const command =
    subject?.type === 'command' && 'command' in subject && typeof subject.command === 'string'
      ? subject.command
      : request.title;
  return {
    permissionId,
    description: request.description ?? request.title,
    toolCall: {
      name: 'command',
      arguments: { command },
      toolCallId:
        subject?.type === 'command' && 'toolCallId' in subject
          ? typeof subject.toolCallId === 'string'
            ? subject.toolCallId
            : undefined
          : undefined,
    },
    options: request.options.map((option) => ({
      optionId: option.optionId,
      label: option.name,
      kind:
        option.kind === 'allow_once' ||
        option.kind === 'allow_always' ||
        option.kind === 'reject_once' ||
        option.kind === 'reject_always'
          ? option.kind
          : undefined,
    })),
  };
}

function advertised(capabilities: AgentCapabilities | undefined): {
  sessions: boolean;
  fork: boolean;
  delete: boolean;
  additionalDirectories: boolean;
  image: boolean;
  audio: boolean;
  embeddedContext: boolean;
  mcpStdio: boolean;
  mcpHttp: boolean;
  mcpAcp: boolean;
} {
  const session = capabilities?.session;
  return {
    sessions: session !== undefined && session !== null,
    fork: session?.fork !== undefined && session.fork !== null,
    delete: session?.delete !== undefined && session.delete !== null,
    additionalDirectories:
      session?.additionalDirectories !== undefined && session.additionalDirectories !== null,
    image: session?.prompt?.image !== undefined && session.prompt.image !== null,
    audio: session?.prompt?.audio !== undefined && session.prompt.audio !== null,
    embeddedContext:
      session?.prompt?.embeddedContext !== undefined && session.prompt.embeddedContext !== null,
    mcpStdio: session?.mcp?.stdio !== undefined && session.mcp.stdio !== null,
    mcpHttp: session?.mcp?.http !== undefined && session.mcp.http !== null,
    mcpAcp: session?.mcp?.acp !== undefined && session.mcp.acp !== null,
  };
}

function supportedMcpServers(
  options: AgentSessionOptions,
  capabilities: ReturnType<typeof advertised>,
): NewSessionRequest['mcpServers'] {
  return options.mcpServers
    ?.filter((server) => {
      if (server.type === 'http' || server.type === 'sse') return capabilities.mcpHttp;
      if (server.type === 'acp') return capabilities.mcpAcp;
      return capabilities.mcpStdio;
    })
    .map((server) =>
      server.type === 'sse' ? { ...server, type: 'http' as const } : server,
    ) as NewSessionRequest['mcpServers'];
}

export class AcpV2AgentDriver implements AgentDriver {
  constructor(
    private spawnImpl: typeof spawn = spawn,
    private logger: Logger = noopLogger,
    private createTransport: (child: ChildProcess, logger: Logger) => AgentStreamTransport = (
      child,
      logger,
    ) => new ProcessStreamTransport(child, logger),
  ) {}

  async startSession(
    command: string,
    args: string[],
    options: AgentSessionOptions,
    callbacks: AgentSessionCallbacks,
  ): Promise<AgentSession> {
    const child = this.spawnImpl(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: cleanEnv(options.env),
      cwd: options.cwd,
    });
    const transport = this.createTransport(child, this.logger);
    const sessions = new Map<string, ActiveCallbacks>();
    const pendingUpdates = new Map<string, UpdateSessionNotification[]>();
    let permissionSequence = 0;

    const routeUpdate = async (notification: UpdateSessionNotification): Promise<void> => {
      const active = sessions.get(notification.sessionId);
      if (!active) {
        const queued = pendingUpdates.get(notification.sessionId) ?? [];
        queued.push(notification);
        pendingUpdates.set(notification.sessionId, queued);
        return;
      }
      for (const event of projectV2SessionUpdate(notification.update)) {
        await active.callbacks.onUpdate(event);
      }
      if (notification.update.sessionUpdate === 'state_update') {
        const state = notification.update as {
          state: string;
          stopReason?: string;
          usage?: unknown;
        };
        if (state.state === 'idle') {
          const stop = {
            stopReason: state.stopReason ?? 'end_turn',
            usage: normalizeAcpUsage(state.usage),
          };
          const waiter = active.waiters.shift();
          if (waiter) waiter.resolve(stop);
          else active.stops.push(stop);
        }
      }
    };

    const app = client({ name: 'agentctl' });
    app.onNotification(methods.client.session.update, ({ params }) => routeUpdate(params));
    app.onRequest(methods.client.session.requestPermission, async ({ params }) => {
      const active = sessions.get(params.sessionId);
      if (!active) return { outcome: { outcome: 'cancelled' as const } };
      const permissionId = `${params.sessionId}:${String(++permissionSequence)}`;
      const request = toPermissionRequest(params, permissionId);
      const response = await active.callbacks.onRequestPermission(request);
      const option = response.optionId
        ? params.options.find((entry) => entry.optionId === response.optionId)
        : params.options.find((entry) =>
            response.allowed ? entry.kind.startsWith('allow') : entry.kind.startsWith('reject'),
          );
      return option
        ? { outcome: { outcome: 'selected' as const, optionId: option.optionId } }
        : { outcome: { outcome: 'cancelled' as const } };
    });

    const connection = app.connect(ndJsonStream(transport.stdin, transport.stdout));
    let capabilities = advertised(undefined);
    let closed = false;
    const closedPromise = Promise.race([connection.closed, transport.closed]);
    const handle: AgentSession = {
      id: null,
      history: 'fresh',
      closed: closedPromise,
      onError(handler) {
        child.on('error', handler);
      },
      onClose(handler) {
        child.once('exit', (code, signal) => handler({ code, signal }));
      },
      async prompt(text, attachments, embeddedContext) {
        if (!this.id) throw new AgentError('invalid_request', 'Agent session has no ID');
        const active = sessions.get(this.id);
        if (!active) throw new AgentError('transport_lost', 'Agent session is not active');
        active.stops.length = 0;
        const blocks = (await buildPromptBlocks({
          text,
          attachments,
          embeddedContext,
          supportsImage: capabilities.image,
          supportsAudio: capabilities.audio,
          supportsEmbeddedContext: capabilities.embeddedContext,
        })) as ContentBlock[];
        const stopPromise = new Promise<TurnStop>((resolve, reject) => {
          active.waiters.push({ resolve, reject });
        });
        try {
          await withTimeout(
            connection.agent.request(methods.agent.session.prompt, {
              sessionId: this.id,
              prompt: blocks,
            }),
            getAgentRequestTimeoutMs(),
            'sending ACP v2 prompt',
          );
          return await withTimeout(
            stopPromise,
            getAgentRequestTimeoutMs(),
            'waiting for ACP v2 turn',
          );
        } catch (error) {
          const waiter = active.waiters.shift();
          waiter?.reject(error);
          throw error;
        }
      },
      async authenticate(methodId) {
        await connection.agent.request(methods.agent.auth.login, { methodId });
      },
      async cancel() {
        if (this.id) {
          await connection.agent.notify(methods.agent.session.cancel, { sessionId: this.id });
        }
      },
      async close() {
        if (closed) return;
        closed = true;
        if (this.id && capabilities.sessions) {
          try {
            await connection.agent.request(methods.agent.session.close, { sessionId: this.id });
          } catch {
            // Process shutdown remains authoritative.
          }
          sessions.delete(this.id);
        }
        connection.close();
        transport.kill();
      },
      async updateModel(modelId) {
        if (!this.id || !options.resolvedModelConfigId) return;
        await connection.agent.request(methods.agent.session.setConfigOption, {
          sessionId: this.id,
          configId: options.resolvedModelConfigId,
          type: 'id',
          value: modelId,
        });
      },
      async updateConfigOption(configId, value) {
        if (!this.id) return [];
        const result = await connection.agent.request(methods.agent.session.setConfigOption, {
          sessionId: this.id,
          configId,
          type: typeof value === 'boolean' ? 'boolean' : 'id',
          value,
        });
        return productConfigOptions(result.configOptions);
      },
      async setMode(modeId) {
        if (!this.id) return;
        await connection.agent.request(methods.agent.session.setConfigOption, {
          sessionId: this.id,
          configId: 'mode',
          type: 'id',
          value: modeId,
        });
      },
      async deleteSession(sessionId) {
        if (capabilities.delete) {
          await connection.agent.request(methods.agent.session.delete, { sessionId });
        }
      },
      async listSessions(params) {
        if (!capabilities.sessions) return { sessions: [] };
        const result = await connection.agent.request(methods.agent.session.list, params ?? {});
        return { sessions: result.sessions, nextCursor: result.nextCursor ?? undefined };
      },
      async logout() {
        await connection.agent.request(methods.agent.auth.logout, {});
      },
    };

    void closedPromise.then(
      () => {
        const error = new AgentError('transport_lost', 'ACP v2 connection closed');
        for (const active of sessions.values()) {
          for (const waiter of active.waiters.splice(0)) waiter.reject(error);
        }
      },
      (error: unknown) => {
        for (const active of sessions.values()) {
          for (const waiter of active.waiters.splice(0)) waiter.reject(error);
        }
      },
    );

    try {
      const initialization = await withTimeout(
        connection.agent.request(methods.agent.initialize, {
          protocolVersion: PROTOCOL_VERSION,
          info: { name: 'agentctl', version: '1.0.0' },
          capabilities: {},
        }),
        getAgentRequestTimeoutMs(),
        'initializing ACP v2 connection',
      );
      if (initialization.protocolVersion !== PROTOCOL_VERSION) {
        throw new AgentError(
          'unsupported',
          `Unsupported ACP v2 protocol version ${String(initialization.protocolVersion)}`,
        );
      }
      capabilities = advertised(initialization.capabilities);
      if (!capabilities.sessions) {
        throw new AgentError('unsupported', 'Agent does not advertise ACP v2 session support');
      }

      const request: NewSessionRequest = {
        cwd: options.cwd,
        additionalDirectories: capabilities.additionalDirectories
          ? options.additionalDirectories
          : undefined,
        mcpServers: supportedMcpServers(options, capabilities),
      };
      let response: { sessionId?: string; configOptions?: SessionConfigOption[] };
      if (options.intent.kind === 'fork' && capabilities.fork) {
        try {
          response = await withTimeout(
            connection.agent.request(methods.agent.session.fork, {
              sessionId: options.intent.sessionId,
              ...request,
            }),
            getAgentRequestTimeoutMs(),
            'forking ACP v2 session',
          );
          if (!response.sessionId || response.sessionId === options.intent.sessionId) {
            throw new AgentError('agent_failure', 'ACP v2 fork returned an invalid session ID');
          }
          handle.history = 'restored';
        } catch (error) {
          if (errorCode(error) !== -32601) throw error;
          response = await withTimeout(
            connection.agent.request(methods.agent.session.new, request),
            getAgentRequestTimeoutMs(),
            'creating ACP v2 fallback session',
          );
        }
      } else if (options.intent.kind === 'resume') {
        try {
          const resumed = await withTimeout(
            connection.agent.request(methods.agent.session.resume, {
              sessionId: options.intent.sessionId,
              ...request,
              replayFrom: { type: 'start' },
            }),
            getAgentRequestTimeoutMs(),
            'resuming ACP v2 session',
          );
          response = { sessionId: options.intent.sessionId, configOptions: resumed.configOptions };
          handle.history = 'restored';
        } catch (error) {
          if (!isSessionNotFound(error)) throw error;
          response = await withTimeout(
            connection.agent.request(methods.agent.session.new, request),
            getAgentRequestTimeoutMs(),
            'creating ACP v2 fallback session',
          );
        }
      } else {
        response = await withTimeout(
          connection.agent.request(methods.agent.session.new, request),
          getAgentRequestTimeoutMs(),
          'creating ACP v2 session',
        );
      }

      handle.id = response.sessionId ?? null;
      if (!handle.id) throw new AgentError('agent_failure', 'ACP v2 agent returned no session ID');
      const active: ActiveCallbacks = { callbacks, stops: [], waiters: [] };
      sessions.set(handle.id, active);
      for (const notification of pendingUpdates.get(handle.id) ?? [])
        await routeUpdate(notification);
      pendingUpdates.delete(handle.id);

      const configOptions = productConfigOptions(response.configOptions);
      handle.availableModes = descriptorFromInitialization(initialization, configOptions).modes;
      return handle;
    } catch (error) {
      if (isAuthError(error)) {
        const configOptions =
          error && typeof error === 'object' && 'data' in error
            ? productConfigOptions(
                (error as { data?: { configOptions?: SessionConfigOption[] } }).data?.configOptions,
              )
            : [];
        throw new AgentAuthenticationRequiredError(handle, configOptions);
      }
      await handle.close();
      throw error;
    }
  }

  async inspectProvider(
    command: string,
    args: string[],
    env?: Record<string, string>,
  ): Promise<AgentDescriptor> {
    const child = this.spawnImpl(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: cleanEnv(env),
      cwd: os.tmpdir(),
    });
    const transport = this.createTransport(child, this.logger);
    const app = client({ name: 'agentctl-probe' });
    app.onNotification(methods.client.session.update, () => undefined);
    app.onRequest(methods.client.session.requestPermission, () => ({
      outcome: { outcome: 'cancelled' },
    }));
    const connection: ClientConnection = app.connect(
      ndJsonStream(transport.stdin, transport.stdout),
    );
    let initialization: InitializeResponse | undefined;
    try {
      initialization = await connection.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        info: { name: 'agentctl-probe', version: '1.0.0' },
        capabilities: {},
      });
      const capabilities = advertised(initialization.capabilities);
      let configOptions: ACPConfigOption[] = [];
      if (capabilities.sessions) {
        const created = await connection.agent.request(methods.agent.session.new, {
          cwd: os.tmpdir(),
          mcpServers: [],
        });
        configOptions = productConfigOptions(created.configOptions);
        await connection.agent
          .request(methods.agent.session.close, { sessionId: created.sessionId })
          .catch(() => undefined);
      }
      return descriptorFromInitialization(initialization, configOptions);
    } catch (error) {
      if (isAuthError(error)) {
        if (initialization) {
          return {
            ...descriptorFromInitialization(initialization, []),
            status: 'needs_auth',
          };
        }
        return {
          status: 'needs_auth',
          configOptions: [],
          authMethods: [],
          supportsDynamicModel: false,
          supportsDynamicConfig: false,
          supportsLogout: false,
        };
      }
      throw error;
    } finally {
      connection.close();
      transport.kill();
    }
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
    params: Record<string, unknown> = {},
  ): Promise<void> {
    await this.withControlConnection(command, args, env, 'agentctl-login', async (connection) => {
      await connection.agent.request(methods.agent.auth.login, {
        methodId,
        _meta: Object.keys(params).length > 0 ? params : undefined,
      });
    });
  }

  async logoutProvider(
    command: string,
    args: string[],
    env?: Record<string, string>,
  ): Promise<void> {
    await this.withControlConnection(command, args, env, 'agentctl-logout', async (connection) => {
      await connection.agent.request(methods.agent.auth.logout, {});
    });
  }

  private async withControlConnection(
    command: string,
    args: string[],
    env: Record<string, string> | undefined,
    name: string,
    operation: (connection: ClientConnection, initialization: InitializeResponse) => Promise<void>,
  ): Promise<void> {
    const child = this.spawnImpl(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: cleanEnv(env),
      cwd: os.tmpdir(),
    });
    const transport = this.createTransport(child, this.logger);
    const app = client({ name });
    app.onNotification(methods.client.session.update, () => undefined);
    app.onRequest(methods.client.session.requestPermission, () => ({
      outcome: { outcome: 'cancelled' },
    }));
    const connection = app.connect(ndJsonStream(transport.stdin, transport.stdout));
    try {
      const initialization = await connection.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        info: { name, version: '1.0.0' },
        capabilities: {},
      });
      await operation(connection, initialization);
    } finally {
      connection.close();
      transport.kill();
    }
  }
}
