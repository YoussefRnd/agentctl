import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
  type NewSessionRequest,
  type NewSessionResponse,
  type SessionConfigOption,
  type UpdateSessionNotification,
} from '@agentclientprotocol/sdk/experimental/v2';
import { findAgentConfigOption, withCustomModels } from '@agentctl/shared';
import { spawn, type ChildProcess } from 'node:child_process';
import type { AgentDiagnosticsRecorder } from '../../agent/diagnostics.js';
import { AgentAuthenticationRequiredError, AgentError } from '../../agent/errors.js';
import type {
  AgentDriver,
  AgentPromptResult,
  AgentSession,
  AgentSessionCallbacks,
  AgentSessionOptions,
} from '../../agent/types.js';
import { applicationInfo } from '../../config/application-info.js';
import { DEFAULT_AGENT_MODEL, getAgentRequestTimeoutMs } from '../../config/runtime-defaults.js';
import { noopLogger, type Logger } from '../../logger.js';
import { getBestPermissionOption } from '../../security/permission-options.js';
import { formatElicitationResponse, projectElicitationRequest } from '../protocol/elicitations.js';
import {
  isAcpAuthenticationRequired,
  isAcpMethodNotFound,
  isAcpSessionNotFound,
} from '../protocol/error-classifier.js';
import { negotiateV2 } from '../protocol/negotiation.js';
import { PermissionMetadataCache } from '../protocol/permission-metadata.js';
import { waitForRequest } from '../protocol/request-cancellation.js';
import { AcpRequestScopes, SESSION_REQUEST_METHODS } from '../protocol/request-scopes.js';
import { assertAcpSessionPaths } from '../protocol/session-params.js';
import { AcpSubagentSessions, isSubagentNotification } from '../protocol/subagent-sessions.js';
import { normalizeAcpUsage } from '../protocol/usage.js';
import {
  bindSessionProcessEvents,
  ProcessStreamTransport,
  spawnManagedProcess,
} from '../transport/acp-process-lifecycle.js';
import { withTimeout } from '../transport/acp-process-lifecycle.js';
import {
  ACP_MAX_PENDING_UPDATE_BYTES,
  ACP_MAX_PENDING_UPDATES,
  acpPayloadBytes,
} from '../transport/limits.js';
import { cancellableCallbacks } from '../transport/session-requests.js';
import { withProcessDiagnostics } from '../transport/stderr.js';
import { wrapDebug } from '../transport/stream-debug.js';
import { withSessionSetupTracking } from '../transport/subagent-stream.js';
import { guardAcpTurns } from '../transport/turn-control.js';
import { AcpUpdateQueue } from '../transport/update-drain.js';
import type { AgentStreamTransport } from '../types.js';
import {
  advertised,
  descriptorFromInitialization,
  productConfigOptions,
  supportedMcpServers,
} from './capabilities.js';
import { AcpV2ProviderControls } from './control.js';
import { createV2SessionProjector } from './events.js';
import { toPermissionRequest } from './permissions.js';
import { createV2Session, type ActiveCallbacks } from './session.js';
export { toPermissionRequest } from './permissions.js';

export class AcpV2AgentDriver implements AgentDriver {
  private readonly controls: AcpV2ProviderControls;
  constructor(
    private spawnImpl: typeof spawn = spawn,
    private logger: Logger = noopLogger,
    private createTransport: (child: ChildProcess, logger: Logger) => AgentStreamTransport = (
      child,
      logger,
    ) => new ProcessStreamTransport(child, logger),
    private diagnostics?: AgentDiagnosticsRecorder,
  ) {
    this.controls = new AcpV2ProviderControls(spawnImpl, logger, createTransport);
  }

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
    let pendingUpdateBytes = 0;
    let permissionSequence = 0;

    const routeUpdate = async (
      notification: UpdateSessionNotification,
      historical = false,
    ): Promise<void> => {
      const active = activeSession(notification.sessionId);
      if (!active) {
        if (!settingUpSession) return;
        const bytes = acpPayloadBytes(notification);
        if (
          pendingUpdates.length >= ACP_MAX_PENDING_UPDATES ||
          bytes > ACP_MAX_PENDING_UPDATE_BYTES - pendingUpdateBytes
        )
          throw new AgentError('agent_failure', 'Too many ACP updates before session setup');
        pendingUpdates.push({ notification, historical });
        pendingUpdateBytes += bytes;
        return;
      }
      if (isSubagentNotification(notification)) {
        await subagents.update(notification, historical);
        return;
      }
      const ordinary = notification as UpdateSessionNotification;
      if (historical && ordinary.update.sessionUpdate === 'notice') return;
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
            const bytes = acpPayloadBytes(event);
            if (
              active.pendingInsertion.length >= ACP_MAX_PENDING_UPDATES ||
              bytes > ACP_MAX_PENDING_UPDATE_BYTES - (active.pendingInsertionBytes ?? 0)
            )
              throw new AgentError(
                'agent_failure',
                'Too many ACP user updates before prompt acceptance',
              );
            active.pendingInsertion.push(event);
            active.pendingInsertionBytes = (active.pendingInsertionBytes ?? 0) + bytes;
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
      const notification = params;
      return updates
        .enqueue(() => routeUpdate(notification, historical), notification)
        .catch(() => {
          // drain() still fails completion; log only operational metadata here.
          this.logger.warn(
            { sessionId: notification.sessionId },
            'Failed to apply ACP session update',
          );
        });
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
    const connection = app.connect(
      wrapDebug(adapted, (direction, frame) => requestScopes.observe(direction, frame)),
    );
    let capabilities = advertised(undefined);
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
      pendingUpdateBytes = 0;
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
    const handle = createV2Session({
      options,
      child,
      connection,
      transport,
      capabilities: () => capabilities,
      processEvents,
      requests,
      updates,
      closedPromise,
      sessions,
      rejectTurns,
      dropSession: (id) => {
        sessions.delete(id);
        projectors.delete(id);
      },
    });

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
      pendingUpdateBytes = 0;
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

  inspectProvider: NonNullable<AgentDriver['inspectProvider']> = (...args) =>
    this.controls.inspectProvider(...args);

  listSessions: NonNullable<AgentDriver['listSessions']> = (...args) =>
    this.controls.listSessions(...args);

  deleteSession: NonNullable<AgentDriver['deleteSession']> = (...args) =>
    this.controls.deleteSession(...args);

  authenticateProvider: NonNullable<AgentDriver['authenticateProvider']> = (...args) =>
    this.controls.authenticateProvider(...args);

  logoutProvider: NonNullable<AgentDriver['logoutProvider']> = (...args) =>
    this.controls.logoutProvider(...args);
}
