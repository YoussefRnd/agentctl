import { applicationInfo } from '../../config/application-info.js';
import { AcpSubagentSessions, isSubagentNotification } from '../protocol/subagent-sessions.js';
import { withSessionSetupTracking } from '../transport/subagent-stream.js';
import { AcpRequestScopes, SESSION_REQUEST_METHODS } from '../protocol/request-scopes.js';
import { wrapDebug } from '../transport/stream-debug.js';
import { AcpUpdateQueue } from '../transport/update-drain.js';
import { projectElicitationRequest, formatElicitationResponse } from '../protocol/elicitations.js';
import { PermissionMetadataCache } from '../protocol/permission-metadata.js';
import { toolArgumentsFrom } from '../protocol/tool-call-utils.js';
import { getBestPermissionOption } from '../../security/permission-options.js';
import { withProcessDiagnostics } from '../transport/stderr.js';
import { withCustomModels } from '@agentctl/shared';
import { respondToBrowserAuthentication } from '../protocol/browser-auth.js';
import { waitForRequest } from '../protocol/request-cancellation.js';
import { assertAcpSessionPaths } from '../protocol/session-params.js';
import { guardAcpTurns } from '../transport/turn-control.js';
import { cancellableCallbacks } from '../transport/session-requests.js';
import {
  ACP_MAX_PENDING_UPDATES,
  ACP_SESSION_CLOSE_TIMEOUT_MS,
  ACP_SESSION_OPERATION_TIMEOUT_MS,
} from '../transport/limits.js';
import { negotiateV2 } from '../protocol/negotiation.js';
import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type AgentCapabilities,
  type ClientConnection,
  type InitializeResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type RequestPermissionRequest,
  type SessionConfigOption,
  type UpdateSessionNotification,
  RequestError,
} from '@agentclientprotocol/sdk/experimental/v2';
import {
  findAgentConfigOption,
  createCapabilitySnapshot,
  type AgentConfigOption,
} from '@agentctl/shared';
import type {
  AgentDescriptor,
  AgentAuthenticationOptions,
  AgentDriver,
  AgentInspectionOptions,
  AgentPermissionRequest,
  AgentSession,
  AgentSessionCallbacks,
  AgentSessionOptions,
  AgentStopReason,
  AgentPromptResult,
  AgentUpdate,
  AgentUsage,
} from '../../agent/types.js';
import {
  AgentAuthenticationRequiredError,
  AgentError,
  normalizeAgentError,
  AgentPromptRejectedError,
} from '../../agent/errors.js';
import { type Logger, noopLogger } from '../../logger.js';
import type { AgentStreamTransport } from '../types.js';
import {
  ProcessStreamTransport,
  spawnManagedProcess,
  bindSessionProcessEvents,
} from '../transport/acp-process-lifecycle.js';
import { buildPromptBlocks } from '../protocol/prompt.js';
import { normalizeAcpUsage } from '../protocol/usage.js';
import {
  getAgentRequestTimeoutMs,
  DEFAULT_PROVIDER_AUTH_TIMEOUT_MS,
  DEFAULT_AGENT_MODEL,
} from '../../config/runtime-defaults.js';
import { withTimeout } from '../transport/capabilities-cache.js';
import { projectV2ConfigOption, createV2SessionProjector } from './events.js';
import { withV2StateErrors } from './state-error-compatibility.js';
import {
  isAcpAuthenticationRequired,
  isAcpMethodNotFound,
  isAcpSessionNotFound,
} from '../protocol/error-classifier.js';
import type { AgentDiagnosticsRecorder } from '../../agent/diagnostics.js';

interface TurnStop {
  stopReason: AgentStopReason;
  usage?: AgentUsage;
  error?: AgentPromptResult['error'];
}

interface ActiveCallbacks {
  callbacks: AgentSessionCallbacks;
  pendingInsertion?: Extract<AgentUpdate, { type: 'user_text' }>[];
  waiters: Array<{ resolve(value: TurnStop): void; reject(error: unknown): void }>;
}

function productConfigOptions(options?: SessionConfigOption[]): AgentConfigOption[] {
  return (options ?? [])
    .map(projectV2ConfigOption)
    .filter((option): option is AgentConfigOption => option !== null);
}

function descriptorFromInitialization(
  initialization: InitializeResponse,
  configOptions: AgentConfigOption[],
  options?: AgentInspectionOptions,
): AgentDescriptor {
  const authMethods = (initialization.authMethods ?? []).map((method) => {
    if (method.type === 'terminal') {
      const terminalMethod = method as {
        methodId: string;
        name: string;
        description?: string | null;
        args?: string[];
        env?: Record<string, string>;
      };
      return {
        id: terminalMethod.methodId,
        name: terminalMethod.name,
        type: 'terminal' as const,
        description: terminalMethod.description ?? null,
        args: Array.isArray(terminalMethod.args) ? terminalMethod.args : undefined,
        env:
          typeof terminalMethod.env === 'object' && terminalMethod.env !== null
            ? terminalMethod.env
            : undefined,
      };
    }
    return {
      id: method.methodId,
      name: method.name,
      type: 'agent' as const,
      description: method.description ?? null,
    };
  });
  const modes =
    findAgentConfigOption(configOptions, 'mode')?.options?.map((entry) => entry.value) ?? [];
  const capabilities = advertised(initialization.capabilities);
  const supportsDynamicModel = !!findAgentConfigOption(configOptions, 'model');
  const supportsDynamicConfig = configOptions.length > 0;
  const supportsLogout = authMethods.length > 0;
  const descriptor: AgentDescriptor = {
    status: 'ready',
    configOptions,
    authMethods,
    supportsDynamicModel,
    supportsDynamicConfig,
    supportsLogout,
    features: {
      sessions: {
        resume: capabilities.sessions,
        fork: capabilities.fork,
        delete: capabilities.delete,
        list: capabilities.sessions,
      },
      prompts: {
        image: capabilities.image,
        audio: capabilities.audio,
        embeddedContext: capabilities.embeddedContext,
      },
      configuration: { model: supportsDynamicModel, options: supportsDynamicConfig },
      authentication: { logout: supportsLogout },
    },
    modes,
  };
  descriptor.snapshot = createCapabilitySnapshot(descriptor.features!, 'handshake', {
    providerVersion: options?.providerVersion,
    protocolVersion: String(PROTOCOL_VERSION),
  });
  return descriptor;
}

export function toPermissionRequest(
  request: RequestPermissionRequest,
  permissionId: string,
): AgentPermissionRequest {
  const options = request.options.map((option) => ({
    optionId: option.optionId,
    label: option.name,
    kind: option.kind,
  }));
  const subject = request.subject;
  const common = {
    permissionId,
    source: 'provider' as const,
    subject,
    description: request.description ?? request.title,
    options,
  };
  if (subject?.type === 'tool_call' && 'toolCall' in subject) {
    const call = subject.toolCall as {
      name?: unknown;
      title?: unknown;
      rawInput?: unknown;
      toolCallId?: unknown;
      kind?: unknown;
      locations?: { path: string; line?: number | null }[] | null;
    };
    return {
      ...common,
      toolCall: {
        name:
          typeof call.name === 'string'
            ? call.name
            : typeof call.title === 'string'
              ? call.title
              : request.title,
        arguments: toolArgumentsFrom(call.rawInput),
        rawInput: call.rawInput,
        kind: typeof call.kind === 'string' ? call.kind : undefined,
        locations: call.locations?.map((location) => ({
          path: location.path,
          line: location.line ?? undefined,
        })),
        toolCallId: typeof call.toolCallId === 'string' ? call.toolCallId : undefined,
      },
    };
  }
  if (
    subject?.type === 'command' &&
    'command' in subject &&
    'cwd' in subject &&
    typeof subject.command === 'string' &&
    typeof subject.cwd === 'string'
  ) {
    return {
      ...common,
      toolCall: {
        name: 'command',
        kind: 'execute',
        arguments: { command: subject.command, cwd: subject.cwd },
        toolCallId:
          'toolCallId' in subject && typeof subject.toolCallId === 'string'
            ? subject.toolCallId
            : undefined,
      },
    };
  }
  return { ...common, toolCall: { name: request.title, kind: 'other' } };
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
      if (server.type === 'http') return capabilities.mcpHttp;
      if (server.type === 'sse') return false;
      if (server.type === 'acp') return capabilities.mcpAcp;
      return capabilities.mcpStdio;
    })
    .map((server) => ({
      ...server,
      type: server.type ?? 'stdio',
    })) as NewSessionRequest['mcpServers'];
}

export class AcpV2AgentDriver implements AgentDriver {
  constructor(
    private spawnImpl: typeof spawn = spawn,
    private logger: Logger = noopLogger,
    private createTransport: (child: ChildProcess, logger: Logger) => AgentStreamTransport = (
      child,
      logger,
    ) => new ProcessStreamTransport(child, logger),
    private diagnostics?: AgentDiagnosticsRecorder,
  ) {}

  async startSession(
    command: string,
    args: string[],
    options: AgentSessionOptions,
    callbacks: AgentSessionCallbacks,
  ): Promise<AgentSession> {
    const requests = cancellableCallbacks(callbacks);
    callbacks = requests.callbacks;
    const managed = spawnManagedProcess({
      command,
      args,
      env: options.env,
      cwd: options.cwd,
      spawnImpl: this.spawnImpl,
      logger: this.logger,
      diagnostics: this.diagnostics,
      adapter: 'acp-v2',
      providerId: options.providerId,
      createTransport: this.createTransport,
    });
    const { child, transport } = managed;
    const processEvents = bindSessionProcessEvents(child);
    const sessions = new Map<string, ActiveCallbacks>();
    const projectors = new Map<string, ReturnType<typeof createV2SessionProjector>>();
    const permissionMetadata = new Map<string, PermissionMetadataCache>();
    const pendingUpdates: Array<{
      notification: UpdateSessionNotification;
      historical: boolean;
    }> = [];
    const subagents = new AcpSubagentSessions<ActiveCallbacks>((id) => {
      const active = sessions.get(id);
      if (!active) throw new Error('Unknown ACP root session');
      return active;
    });
    const activeSession = (id: string) => {
      try {
        return subagents.resolve(id);
      } catch {
        return undefined;
      }
    };
    let settingUpSession = true;
    let permissionSequence = 0;

    const routeUpdate = async (
      notification: UpdateSessionNotification,
      historical = false,
    ): Promise<void> => {
      const active = activeSession(notification.sessionId);
      if (!active) {
        if (!settingUpSession) return;
        if (pendingUpdates.length >= ACP_MAX_PENDING_UPDATES)
          throw new AgentError('agent_failure', 'Too many ACP updates before session setup');
        pendingUpdates.push({ notification, historical });
        return;
      }
      if (isSubagentNotification(notification)) {
        await subagents.update(notification, historical);
        return;
      }
      const ordinary = notification as UpdateSessionNotification;
      const childSession = subagents.isChild(notification.sessionId);
      if (childSession && ordinary.update.sessionUpdate === 'state_update') {
        const { sessionUpdate: _, ...state } = ordinary.update;
        if (typeof state.state === 'string')
          await subagents.state(
            notification.sessionId,
            { ...state, state: state.state },
            historical,
          );
        return;
      }
      if (ordinary.update.sessionUpdate === 'tool_call_update') {
        let cache = permissionMetadata.get(notification.sessionId);
        if (!cache) {
          cache = new PermissionMetadataCache();
          permissionMetadata.set(notification.sessionId, cache);
        }
        cache.remember(ordinary.update);
      }
      let projector = projectors.get(notification.sessionId);
      if (!projector) {
        projector = createV2SessionProjector();
        projectors.set(notification.sessionId, projector);
      }
      try {
        for (const event of projector(ordinary.update)) {
          if (!childSession && event.type === 'config_option_update') {
            event.configOptions = withCustomModels(event.configOptions, options.customModels ?? []);
            handle.configOptions = event.configOptions;
          }
          if (!childSession && event.type === 'user_text' && active.pendingInsertion) {
            if (active.pendingInsertion.length >= ACP_MAX_PENDING_UPDATES)
              throw new AgentError(
                'agent_failure',
                'Too many ACP user updates before prompt acceptance',
              );
            active.pendingInsertion.push(event);
          } else await active.callbacks.onUpdate(event);
        }
      } finally {
        if (notification.update.sessionUpdate === 'state_update') {
          const state = notification.update as {
            state: string;
            stopReason?: string;
            usage?: unknown;
            error?: AgentPromptResult['error'];
          };
          if (state.state === 'idle') {
            const waiter = active.waiters.shift();
            if (waiter) {
              if (!state.stopReason)
                waiter.reject(
                  new AgentError(
                    'agent_failure',
                    'ACP v2 foreground work ended without a stop reason',
                  ),
                );
              else
                waiter.resolve({
                  stopReason: state.stopReason,
                  usage: normalizeAcpUsage(state.usage),
                  ...(state.stopReason === 'error' && state.error ? { error: state.error } : {}),
                });
            }
          }
        }
      }
    };

    const app = client({ name: 'agentctl' });
    const updates = new AcpUpdateQueue();
    app.onNotification(methods.client.session.update, ({ params }) => {
      const historical = adapted.isHistorical(subagents.rootSessionId(params.sessionId));
      const notification = stateErrors.restore(params);
      return updates.enqueue(() => routeUpdate(notification, historical));
    });
    app.onRequest(methods.client.session.requestPermission, async ({ params, signal }) => {
      await updates.settled();
      if (signal.aborted) return { outcome: { outcome: 'cancelled' as const } };
      const active = activeSession(params.sessionId);
      if (!active) return { outcome: { outcome: 'cancelled' as const } };
      const permissionId = `${params.sessionId}:${String(++permissionSequence)}`;
      const subject = params.subject;
      const cache = permissionMetadata.get(params.sessionId);
      const enriched =
        subject?.type === 'tool_call' && 'toolCall' in subject && cache
          ? {
              ...params,
              subject: {
                ...subject,
                toolCall: cache.merge(subject.toolCall as { toolCallId: string }),
              },
            }
          : params;
      const request = toPermissionRequest(enriched, permissionId);
      request.subject = params.subject;
      const response = await waitForRequest(
        active.callbacks.onRequestPermission(request, signal),
        signal,
        () => ({ allowed: false, cancelled: true }),
      );
      if (signal.aborted || response.cancelled)
        return { outcome: { outcome: 'cancelled' as const } };
      const optionId =
        response.optionId ??
        getBestPermissionOption(request.options, response.allowed ? 'allow' : 'reject');
      const option = params.options.find((entry) => entry.optionId === optionId);
      return option
        ? { outcome: { outcome: 'selected' as const, optionId: option.optionId } }
        : { outcome: { outcome: 'cancelled' as const } };
    });

    const requestScopes = new AcpRequestScopes<AgentSessionCallbacks>((method, params) => {
      if (!SESSION_REQUEST_METHODS.has(method)) return undefined;
      return typeof params.sessionId === 'string'
        ? activeSession(params.sessionId)?.callbacks
        : callbacks;
    });
    const pendingUrlElicitations = new Map<string, AgentSessionCallbacks>();
    app.onRequest(methods.client.elicitation.create, async ({ params, signal }) => {
      if (!callbacks.onRequestElicitation)
        throw RequestError.invalidParams(undefined, 'Elicitation mode is not supported');
      await updates.settled();
      const request = projectElicitationRequest(params);
      if (!request) return { action: 'decline' as const };
      if (signal.aborted) return { action: 'cancel' as const };
      const target = request.sessionId
        ? activeSession(request.sessionId)?.callbacks
        : request.requestId !== undefined
          ? requestScopes.get(request.requestId)
          : undefined;
      if (!target?.onRequestElicitation) return { action: 'decline' as const };
      const response = await waitForRequest(
        target.onRequestElicitation(request, signal),
        signal,
        () => ({ action: 'cancel' as const }),
      );
      if (signal.aborted) return { action: 'cancel' as const };
      const result = formatElicitationResponse(response, request);
      if (request.mode === 'url' && result.action === 'accept') {
        pendingUrlElicitations.set(request.id, target);
      }
      return result;
    });
    app.onNotification(methods.client.elicitation.complete, async ({ params }) => {
      const target = pendingUrlElicitations.get(params.elicitationId);
      pendingUrlElicitations.delete(params.elicitationId);
      await target?.onElicitationCompleted?.(params.elicitationId);
    });

    const rawStream = ndJsonStream(transport.stdin, transport.stdout);
    const adapted = withSessionSetupTracking(rawStream, {
      onError: (error) => this.logger.warn(error, 'Invalid ACP subagent update'),
    });
    const stateErrors = withV2StateErrors(
      wrapDebug(adapted, (direction, frame) => requestScopes.observe(direction, frame)),
    );
    const connection = app.connect(stateErrors);
    let capabilities = advertised(undefined);
    let closed = false;
    const closedPromise = Promise.race([connection.closed, transport.closed]);
    const rejectTurns = (error: unknown) => {
      for (const active of sessions.values()) {
        for (const waiter of active.waiters.splice(0)) waiter.reject(error);
      }
    };
    const releaseSession = (error: unknown) => {
      processEvents.dispose();
      requests.cancel();
      rejectTurns(error);
      pendingUrlElicitations.clear();
      pendingUpdates.length = 0;
      requestScopes.clear();
      subagents.clear();
      sessions.clear();
      projectors.clear();
      permissionMetadata.clear();
    };
    void closedPromise.then(
      () =>
        releaseSession(
          new AgentError('transport_lost', 'ACP connection closed before the turn completed'),
        ),
      (error: unknown) => releaseSession(withProcessDiagnostics(error, child)),
    );
    const handle: AgentSession = {
      id: null,
      history: 'fresh',
      closed: closedPromise,
      onError: processEvents.onError,
      onClose: processEvents.onClose,
      async prompt(text, attachments, embeddedContext) {
        if (!this.id) throw new AgentError('invalid_request', 'Agent session has no ID');
        const active = sessions.get(this.id);
        if (!active) throw new AgentError('transport_lost', 'Agent session is not active');
        const blocks = await buildPromptBlocks({
          text,
          attachments,
          embeddedContext,
          supportsImage: capabilities.image,
          supportsAudio: capabilities.audio,
          supportsEmbeddedContext: capabilities.embeddedContext,
        });
        const stopPromise = new Promise<TurnStop>((resolve, reject) => {
          active.waiters.push({ resolve, reject });
        });
        void stopPromise.catch(() => undefined);
        active.pendingInsertion = [];
        let inserted = false;
        try {
          const accepted = await connection.agent.request(methods.agent.session.prompt, {
            sessionId: this.id,
            prompt: blocks,
          });
          inserted = true;
          await updates.enqueue(async () => {
            await active.callbacks.onUpdate({
              type: 'user_message_accepted',
              messageId: accepted.messageId,
            });
            for (const event of active.pendingInsertion ?? [])
              await active.callbacks.onUpdate(event);
            active.pendingInsertion = undefined;
          });
          const stop = await stopPromise;
          await updates.drain();
          return { ...stop, userMessageId: accepted.messageId };
        } catch (error) {
          // An unconfirmed insertion must not attach observed messages to local input.
          const buffered = active.pendingInsertion ?? [];
          active.pendingInsertion = undefined;
          await updates
            .enqueue(async () => {
              if (!inserted) await active.callbacks.onUpdate({ type: 'user_message_unconfirmed' });
              for (const event of buffered) await active.callbacks.onUpdate(event);
            })
            .catch(() => undefined);
          const waiter = active.waiters.shift();
          waiter?.reject(error);
          await updates.drain().catch(() => undefined);
          const failure = withProcessDiagnostics(error, child);
          if (!inserted && !connection.signal.aborted && error instanceof RequestError)
            throw withProcessDiagnostics(new AgentPromptRejectedError(error), child);
          throw normalizeAgentError(failure, inserted ? 'accepted' : 'unknown');
        }
      },
      async authenticate(methodId) {
        await withTimeout(
          connection.agent.request(methods.agent.auth.login, { methodId }),
          DEFAULT_PROVIDER_AUTH_TIMEOUT_MS,
          'authenticating ACP session',
        );
      },
      async cancel() {
        if (this.id) {
          await connection.agent.notify(methods.agent.session.cancel, { sessionId: this.id });
        }
      },
      async close() {
        if (closed) return;
        closed = true;
        processEvents.dispose();
        requests.cancel();
        rejectTurns(
          new AgentError('transport_lost', 'ACP session closed before the turn completed'),
        );
        if (this.id && capabilities.sessions) {
          try {
            await withTimeout(
              connection.agent.request(methods.agent.session.close, { sessionId: this.id }),
              ACP_SESSION_CLOSE_TIMEOUT_MS,
              'closing ACP session',
            );
          } catch {
            // Process shutdown remains authoritative.
          }
          sessions.delete(this.id);
          projectors.delete(this.id);
        }
        connection.close();
        transport.kill();
      },
      async updateModel(modelId) {
        const configId =
          findAgentConfigOption(this.configOptions, 'model')?.id ?? options.resolvedModelConfigId;
        if (!this.id || !configId) return;
        const result = await withTimeout(
          connection.agent.request(methods.agent.session.setConfigOption, {
            sessionId: this.id,
            configId,
            type: 'id',
            value: modelId,
          }),
          getAgentRequestTimeoutMs(),
          'setting ACP model',
        );
        return (this.configOptions = withCustomModels(
          productConfigOptions(result.configOptions),
          options.customModels ?? [],
        ));
      },
      async updateConfigOption(configId, value) {
        if (!this.id) return [];
        const result = await withTimeout(
          connection.agent.request(methods.agent.session.setConfigOption, {
            sessionId: this.id,
            configId,
            ...(typeof value === 'boolean'
              ? { type: 'boolean' as const, value }
              : { type: 'id' as const, value }),
          }),
          getAgentRequestTimeoutMs(),
          'setting ACP configuration',
        );
        return (this.configOptions = withCustomModels(
          productConfigOptions(result.configOptions),
          options.customModels ?? [],
        ));
      },
      async setMode(modeId) {
        const mode = findAgentConfigOption(this.configOptions, 'mode');
        if (!mode) throw new AgentError('unsupported', 'Agent did not advertise a mode option');
        await this.updateConfigOption?.(mode.id, modeId);
      },
      async deleteSession(sessionId) {
        if (capabilities.delete) {
          await withTimeout(
            connection.agent.request(methods.agent.session.delete, { sessionId }),
            ACP_SESSION_OPERATION_TIMEOUT_MS,
            'deleting ACP session',
          );
        }
      },
      async listSessions(params) {
        if (!capabilities.sessions) return { sessions: [] };
        const result = await withTimeout(
          connection.agent.request(methods.agent.session.list, params ?? {}),
          ACP_SESSION_OPERATION_TIMEOUT_MS,
          'listing ACP sessions',
        );
        return { sessions: result.sessions, nextCursor: result.nextCursor ?? undefined };
      },
      async logout() {
        await withTimeout(
          connection.agent.request(methods.agent.auth.logout, {}),
          ACP_SESSION_OPERATION_TIMEOUT_MS,
          'logging out of ACP session',
        );
      },
    };

    try {
      const initialization = await withTimeout(
        negotiateV2(
          connection.agent.request(methods.agent.initialize, {
            protocolVersion: PROTOCOL_VERSION,
            info: applicationInfo('agentctl'),
            capabilities: {
              ...(process.platform === 'win32' ? {} : { auth: { terminal: {} } }),
              ...(callbacks.onRequestElicitation ? { elicitation: { form: {}, url: {} } } : {}),
            },
          }),
        ),
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
      this.diagnostics?.record({
        kind: 'connection_ready',
        adapter: 'acp-v2',
        providerId: options.providerId,
        path: 'spawn',
      });
      if (!capabilities.sessions) {
        throw new AgentError('unsupported', 'Agent does not advertise ACP v2 session support');
      }

      assertAcpSessionPaths(
        options.cwd,
        capabilities.additionalDirectories ? options.additionalDirectories : undefined,
      );
      const request: NewSessionRequest = {
        cwd: options.cwd,
        additionalDirectories: capabilities.additionalDirectories
          ? options.additionalDirectories
          : undefined,
        mcpServers: supportedMcpServers(options, capabilities),
      };
      let response: NewSessionResponse;
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
          this.diagnostics?.record({
            kind: 'session_started',
            adapter: 'acp-v2',
            providerId: options.providerId,
            intent: 'fork',
            path: 'provider_fork',
          });
        } catch (error) {
          if (!isAcpMethodNotFound(error)) throw error;
          this.diagnostics?.record({
            kind: 'fallback_used',
            adapter: 'acp-v2',
            providerId: options.providerId,
            intent: 'fork',
            path: 'fresh_session',
            reason: 'fork_method_not_found',
          });
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
          response = { ...resumed, sessionId: options.intent.sessionId };
          handle.history = 'restored';
          this.diagnostics?.record({
            kind: 'session_started',
            adapter: 'acp-v2',
            providerId: options.providerId,
            intent: 'resume',
            path: 'provider_resume',
          });
        } catch (error) {
          if (options.intent.kind === 'resume' && options.intent.requireExisting) throw error;
          if (!isAcpSessionNotFound(error)) throw error;
          this.diagnostics?.record({
            kind: 'fallback_used',
            adapter: 'acp-v2',
            providerId: options.providerId,
            intent: 'resume',
            path: 'fresh_session',
            reason: 'session_not_found',
          });
          response = await withTimeout(
            connection.agent.request(methods.agent.session.new, request),
            getAgentRequestTimeoutMs(),
            'creating ACP v2 fallback session',
          );
        }
      } else {
        if (options.intent.kind === 'fork') {
          this.diagnostics?.record({
            kind: 'fallback_used',
            adapter: 'acp-v2',
            providerId: options.providerId,
            intent: 'fork',
            path: 'fresh_session',
            reason: 'fork_not_supported',
          });
        }
        response = await withTimeout(
          connection.agent.request(methods.agent.session.new, request),
          getAgentRequestTimeoutMs(),
          'creating ACP v2 session',
        );
        if (options.intent.kind === 'new') {
          this.diagnostics?.record({
            kind: 'session_started',
            adapter: 'acp-v2',
            providerId: options.providerId,
            intent: 'new',
            path: 'fresh_session',
          });
        }
      }

      handle.id = response.sessionId ?? null;
      if (!handle.id) throw new AgentError('agent_failure', 'ACP v2 agent returned no session ID');
      await updates.drain();
      const active: ActiveCallbacks = { callbacks, waiters: [] };
      sessions.set(handle.id, active);
      for (const pending of pendingUpdates.splice(0))
        await routeUpdate(pending.notification, pending.historical);
      settingUpSession = false;
      if (response.availableCommands !== undefined) {
        for (const event of createV2SessionProjector()({
          sessionUpdate: 'available_commands_update',
          availableCommands: response.availableCommands,
        }))
          await callbacks.onUpdate(event);
      }

      const configOptions = withCustomModels(
        productConfigOptions(response.configOptions),
        options.customModels ?? [],
      );
      if (Array.isArray(response.configOptions) || options.customModels?.length)
        handle.configOptions = configOptions;
      if (options.selectedModel && options.selectedModel !== DEFAULT_AGENT_MODEL) {
        await handle.updateModel?.(options.selectedModel);
      }
      const thinkingOption = findAgentConfigOption(handle.configOptions, 'thought_level');
      if (
        options.selectedThinkingEffort &&
        thinkingOption?.options?.some((option) => option.value === options.selectedThinkingEffort)
      ) {
        await handle.updateConfigOption?.(thinkingOption.id, options.selectedThinkingEffort);
      }
      handle.availableModes = descriptorFromInitialization(
        initialization,
        handle.configOptions ?? configOptions,
      ).modes;
      guardAcpTurns(
        handle,
        () => {
          connection.close();
          transport.kill();
        },
        { requests },
      );
      return handle;
    } catch (error) {
      if (isAcpAuthenticationRequired(error)) {
        const configOptions =
          error && typeof error === 'object' && 'data' in error
            ? productConfigOptions(
                (error as { data?: { configOptions?: SessionConfigOption[] } }).data?.configOptions,
              )
            : [];
        throw new AgentAuthenticationRequiredError(handle, configOptions);
      }
      await handle.close();
      throw withProcessDiagnostics(error, child);
    }
  }

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
        async (connection, response) => {
          initialization = response;
          let configOptions: AgentConfigOption[] = [];
          if (advertised(response.capabilities).sessions) {
            const created = await withTimeout(
              connection.agent.request(methods.agent.session.new, {
                cwd: os.tmpdir(),
                mcpServers: [],
              }),
              getAgentRequestTimeoutMs(),
              'opening provider probe session',
            );
            configOptions = productConfigOptions(created.configOptions);
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
    operation: (connection: ClientConnection, initialization: InitializeResponse) => Promise<T>,
    options: AgentAuthenticationOptions & { browserAuth?: boolean } = {},
  ): Promise<T> {
    const managed = spawnManagedProcess({
      command,
      args,
      env,
      cwd: os.tmpdir(),
      spawnImpl: this.spawnImpl,
      logger: this.logger,
      createTransport: this.createTransport,
    });
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
      return await withTimeout(
        operation(connection, initialization),
        options.timeoutMs ?? DEFAULT_PROVIDER_AUTH_TIMEOUT_MS,
        'performing provider control operation',
      );
    } catch (error) {
      throw withProcessDiagnostics(error, managed.child);
    } finally {
      options.signal?.removeEventListener('abort', abort);
      connection.close();
      transport.kill();
    }
  }
}
