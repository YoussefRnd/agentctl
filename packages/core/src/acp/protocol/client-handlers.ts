import {
  RequestError,
  type Client,
  type CreateElicitationRequest,
  type CreateElicitationResponse,
  type CreateTerminalRequest,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type WaitForTerminalExitRequest,
  type WriteTextFileRequest,
} from '@agentclientprotocol/sdk';
import type { AgentMcpGateway, AgentSessionCallbacks } from '../../agent/types.js';
import type { Logger } from '../../logger.js';
import { createExtensionRouter } from '../extensions/agentctl.js';
import { resolveAllowedPath } from '../../security/path-security.js';
import { authorizeClientOperation } from './client-authorization.js';
import { createCompactionProjector } from './compaction.js';
import { formatElicitationResponse, projectElicitationRequest } from './elicitations.js';
import { parseNotificationToEvents } from './events.js';
import {
  assertAcpAbsolutePath,
  handleFsReadTextFile,
  handleFsWriteTextFile,
} from './file-system.js';
import { PermissionMetadataCache } from './permission-metadata.js';
import { formatPermissionOutcome, parsePermissionRequest } from './permissions.js';
import { throwIfRequestCancelled, waitForRequest } from './request-cancellation.js';
import type { TerminalManager } from './terminal-manager.js';
import {
  handleTerminalCreate,
  handleTerminalKill,
  handleTerminalOutput,
  handleTerminalRelease,
  handleTerminalWaitForExit,
} from './terminals.js';

/**
 * Per-session context resolved from an incoming ACP request.
 * The per-connection runtime path always resolves to the single active
 * session; the persistent path resolves by sessionId.
 */
export interface ClientSessionContext {
  localSessionId?: string;
  callbacks: AgentSessionCallbacks;
  cwd: string;
  additionalDirectories?: string[];
  /** Called after a terminal is spawned so callers can track terminalId -> session. */
  onTerminalCreated?(terminalId: string, callbacks: AgentSessionCallbacks): void;
}

export interface ClientHandlerContext {
  onRootSession?(sessionId: string): void;
  cwd: string;
  additionalDirectories?: string[];
  terminalManager: TerminalManager;
  logger: Logger;
  mcpGateway?: AgentMcpGateway;
  resolveSession(params?: {
    sessionId?: string;
    requestId?: string | number;
  }): ClientSessionContext;
}

/** Runs a sync handler and surfaces sync throws as rejections. */
function toPromise<T>(fn: () => T): Promise<T> {
  try {
    return Promise.resolve(fn());
  } catch (err) {
    return Promise.reject(err instanceof Error ? err : new Error(String(err)));
  }
}

/**
 * Builds the ACP client-side request handlers for a connection.
 *
 * IMPORTANT: handler keys MUST match the method names the SDK dispatches on
 * the `Client` interface (camelCase: readTextFile, createTerminal, ...).
 * Extensions are explicitly routed below; unknown methods fail with methodNotFound.
 */
export type SignalAwareClientHandlers = Omit<
  Client,
  | 'requestPermission'
  | 'createElicitation'
  | 'writeTextFile'
  | 'createTerminal'
  | 'waitForTerminalExit'
  | 'extMethod'
> & {
  releaseSession(callbacks: ReadonlySet<AgentSessionCallbacks>): void;
  dispose(): void;
  writeTextFile(params: WriteTextFileRequest, signal?: AbortSignal): Promise<Record<string, never>>;
  createTerminal(
    params: CreateTerminalRequest,
    signal?: AbortSignal,
  ): Promise<{ terminalId: string }>;
  waitForTerminalExit(
    params: WaitForTerminalExitRequest,
    signal?: AbortSignal,
  ): ReturnType<typeof handleTerminalWaitForExit>;
  extMethod(
    method: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>>;
  requestPermission(
    params: RequestPermissionRequest,
    signal?: AbortSignal,
  ): Promise<RequestPermissionResponse>;
  createElicitation(
    params: CreateElicitationRequest,
    signal?: AbortSignal,
  ): Promise<CreateElicitationResponse>;
};

export function createClientHandlers(ctx: ClientHandlerContext): SignalAwareClientHandlers {
  const { terminalManager, logger, mcpGateway } = ctx;
  const pendingUrlElicitations = new Map<string, ClientSessionContext>();
  const terminalOwners = new Map<string, AgentSessionCallbacks>();
  const metadata = new WeakMap<AgentSessionCallbacks, PermissionMetadataCache>();
  const compactions = new WeakMap<
    AgentSessionCallbacks,
    ReturnType<typeof createCompactionProjector>
  >();
  const permissionMetadata = (session: ClientSessionContext) => {
    let cache = metadata.get(session.callbacks);
    if (!cache) {
      cache = new PermissionMetadataCache();
      metadata.set(session.callbacks, cache);
    }
    return cache;
  };
  const assertTerminalOwner = (session: ClientSessionContext, terminalId: string) => {
    if (terminalOwners.get(terminalId) !== session.callbacks) {
      throw RequestError.invalidParams(undefined, 'Terminal does not belong to this session');
    }
  };
  const registerTerminal = (session: ClientSessionContext, terminalId: string) => {
    terminalOwners.set(terminalId, session.callbacks);
    session.onTerminalCreated?.(terminalId, session.callbacks);
  };
  const extensionRouter = createExtensionRouter({
    terminalManager,
    logger,
    mcpGateway,
    resolveSession: ctx.resolveSession,
    assertTerminalOwner,
    registerTerminal,
    async publishStatus(sessionId, status) {
      const session = ctx.resolveSession({ sessionId });
      await session.callbacks.onUpdate({ type: 'status', status });
    },
  });

  return {
    releaseSession(callbacks) {
      for (const [id, owner] of terminalOwners) if (callbacks.has(owner)) terminalOwners.delete(id);
      for (const [id, session] of pendingUrlElicitations)
        if (callbacks.has(session.callbacks)) pendingUrlElicitations.delete(id);
      for (const callback of callbacks) {
        metadata.delete(callback);
        compactions.delete(callback);
      }
    },
    dispose() {
      terminalOwners.clear();
      pendingUrlElicitations.clear();
    },
    async sessionUpdate(n) {
      try {
        const session = ctx.resolveSession(n);
        if (
          n.update.sessionUpdate === 'tool_call' ||
          n.update.sessionUpdate === 'tool_call_update'
        ) {
          permissionMetadata(session).remember(n.update);
        }
        let projectCompaction = compactions.get(session.callbacks);
        if (!projectCompaction) {
          projectCompaction = createCompactionProjector();
          compactions.set(session.callbacks, projectCompaction);
        }
        for (const event of parseNotificationToEvents(n, projectCompaction)) {
          await session.callbacks.onUpdate(event);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('not found or inactive')) {
          logger.debug(
            {
              sessionId: n.sessionId,
              sessionUpdate: n.update.sessionUpdate,
            },
            'Ignoring ACP session update notification for inactive or closed session',
          );
          return;
        }
        logger.error(
          {
            err,
            method: 'session/update',
            sessionId: n.sessionId,
            sessionUpdate: n.update.sessionUpdate,
          },
          'Failed to process ACP session update notification',
        );
        throw err;
      }
    },

    async requestPermission(r, signal) {
      if (signal?.aborted) return { outcome: { outcome: 'cancelled' } };
      if (!r.options.length) return { outcome: { outcome: 'cancelled' } };
      const session = ctx.resolveSession(r);
      const domainReq = parsePermissionRequest({
        ...r,
        toolCall: permissionMetadata(session).merge(r.toolCall),
      });
      const domainResp = await waitForRequest(
        session.callbacks.onRequestPermission(domainReq, signal),
        signal,
        () => ({ allowed: false, cancelled: true }),
      );
      if (signal?.aborted) return { outcome: { outcome: 'cancelled' } };
      return formatPermissionOutcome(domainResp, domainReq.options);
    },

    async readTextFile(p) {
      const session = ctx.resolveSession(p);
      return handleFsReadTextFile(
        { path: p.path, line: p.line ?? undefined, limit: p.limit ?? undefined },
        session.cwd,
        session.additionalDirectories,
        session.localSessionId,
      );
    },

    async writeTextFile(p, signal) {
      assertAcpAbsolutePath(p.path);
      const session = ctx.resolveSession(p);
      const target = resolveAllowedPath(p.path, session.cwd, session.additionalDirectories, true);
      await authorizeClientOperation(
        session,
        {
          name: 'fs/write_text_file',
          kind: 'edit',
          arguments: { path: target, content: p.content },
          locations: [{ path: target }],
        },
        `Write ${target}`,
        signal,
      );
      return handleFsWriteTextFile(
        { path: p.path, content: p.content },
        session.cwd,
        session.additionalDirectories,
      );
    },

    async createTerminal(p, signal) {
      if (
        p.outputByteLimit != null &&
        (!Number.isSafeInteger(p.outputByteLimit) || p.outputByteLimit < 0)
      )
        throw RequestError.invalidParams(
          undefined,
          'outputByteLimit must be a non-negative safe integer',
        );
      if (p.cwd !== undefined && p.cwd !== null) assertAcpAbsolutePath(p.cwd);
      const session = ctx.resolveSession(p);
      const env: Record<string, string> = {};
      if (p.env) {
        for (const v of p.env) env[v.name] = v.value;
      }
      const cwd = resolveAllowedPath(
        p.cwd ?? session.cwd,
        session.cwd,
        session.additionalDirectories,
      );
      await authorizeClientOperation(
        session,
        {
          name: 'terminal/create',
          kind: 'execute',
          arguments: { command: p.command, args: p.args ?? [], cwd, env },
        },
        `Run ${p.command}`,
        signal,
      );
      const res = await handleTerminalCreate(
        {
          command: p.command,
          args: p.args,
          cwd: p.cwd ?? undefined,
          env,
          outputByteLimit: p.outputByteLimit ?? undefined,
        },
        terminalManager,
        session.cwd,
        logger,
        session.callbacks.onUpdate,
        session.additionalDirectories,
      );
      registerTerminal(session, res.terminalId);
      return res;
    },

    terminalOutput(p) {
      return toPromise(() => {
        assertTerminalOwner(ctx.resolveSession(p), p.terminalId);
        return handleTerminalOutput(p, terminalManager, logger);
      });
    },

    releaseTerminal(p) {
      return toPromise(() => {
        assertTerminalOwner(ctx.resolveSession(p), p.terminalId);
        const result = handleTerminalRelease(p, terminalManager, logger);
        terminalOwners.delete(p.terminalId);
        return result;
      });
    },

    waitForTerminalExit(p, signal) {
      assertTerminalOwner(ctx.resolveSession(p), p.terminalId);
      return handleTerminalWaitForExit(p, terminalManager, logger, signal);
    },

    killTerminal(p) {
      return toPromise(() => {
        assertTerminalOwner(ctx.resolveSession(p), p.terminalId);
        return handleTerminalKill(p, terminalManager, logger);
      });
    },

    async createElicitation(p, signal) {
      if (signal?.aborted) return { action: 'cancel' };
      const request = projectElicitationRequest(p);
      if (!request) return { action: 'decline' };

      let session: ClientSessionContext;
      try {
        session = ctx.resolveSession({
          sessionId: request.sessionId,
          requestId: request.requestId,
        });
      } catch (err) {
        logger.debug({ err, mode: p.mode }, 'Declining ACP elicitation without a session context');
        return { action: 'decline' };
      }

      if (!session.callbacks.onRequestElicitation)
        throw RequestError.invalidParams(undefined, 'Elicitation mode is not supported');

      const response = await waitForRequest(
        session.callbacks.onRequestElicitation(request, signal),
        signal,
        () => ({ action: 'cancel' as const }),
      );
      if (signal?.aborted) return { action: 'cancel' };
      const result = formatElicitationResponse(response, request);
      if (p.mode === 'url' && result.action === 'accept') {
        pendingUrlElicitations.set(request.id, session);
      }
      return result;
    },

    async completeElicitation(n) {
      const session = pendingUrlElicitations.get(n.elicitationId);
      if (!session) return;
      pendingUrlElicitations.delete(n.elicitationId);
      await session.callbacks.onElicitationCompleted?.(n.elicitationId);
    },

    async extMethod(method, params, signal) {
      throwIfRequestCancelled(signal);
      logger.debug({ method }, 'ACP extension method');
      if (typeof method !== 'string') {
        throw RequestError.invalidRequest(undefined, 'Extension method name must be a string');
      }
      return (await extensionRouter.request(method, params, signal)) as Record<string, unknown>;
    },

    async extNotification(method, rawParams) {
      try {
        if (typeof method !== 'string' || !method.startsWith('_')) return;
        logger.debug({ method }, 'ACP extension notification');
        await extensionRouter.notify(method, rawParams);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('not found or inactive')) {
          logger.debug(
            { method },
            'Ignoring ACP extension notification for inactive or closed session',
          );
          return;
        }
        logger.error({ err, method }, 'Failed to process ACP extension notification');
      }
    },
  };
}
