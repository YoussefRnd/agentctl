import { RequestError, type Client } from '@agentclientprotocol/sdk';
import type { Logger } from '../../logger.js';
import type { AgentMcpGateway, AgentSessionCallbacks } from '../../agent/types.js';
import { parseNotificationToEvents } from './events.js';
import { parsePermissionRequest, formatPermissionOutcome } from './permissions.js';
import { formatElicitationResponse, projectElicitationRequest } from './elicitations.js';
import { handleFsReadTextFile, handleFsWriteTextFile } from './file-system.js';
import {
  handleTerminalCreate,
  handleTerminalKill,
  handleTerminalOutput,
  handleTerminalRelease,
  handleTerminalWaitForExit,
} from './terminals.js';
import type { TerminalManager } from './terminal-manager.js';
import { createExtensionRouter } from './extensions.js';

/**
 * Per-session context resolved from an incoming ACP request.
 * The per-connection runtime path always resolves to the single active
 * session; the persistent path resolves by sessionId.
 */
export interface ClientSessionContext {
  callbacks: AgentSessionCallbacks;
  cwd: string;
  additionalDirectories?: string[];
  /** Called after a terminal is spawned so callers can track terminalId -> session. */
  onTerminalCreated?(terminalId: string): void;
}

export interface ClientHandlerContext {
  cwd: string;
  additionalDirectories?: string[];
  terminalManager: TerminalManager;
  logger: Logger;
  mcpGateway?: AgentMcpGateway;
  resolveSession(params?: { sessionId?: string }): ClientSessionContext;
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
export function createClientHandlers(ctx: ClientHandlerContext): Client {
  const { terminalManager, logger, mcpGateway } = ctx;
  const pendingUrlElicitations = new Map<string, ClientSessionContext>();
  const extensionRouter = createExtensionRouter({
    terminalManager,
    logger,
    mcpGateway,
    resolveSession: ctx.resolveSession,
    async publishStatus(sessionId, status) {
      const session = ctx.resolveSession({ sessionId });
      await session.callbacks.onUpdate({ type: 'status', status });
    },
  });

  return {
    async sessionUpdate(n) {
      try {
        const session = ctx.resolveSession(n);
        for (const event of parseNotificationToEvents(n)) {
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
      }
    },

    async requestPermission(r) {
      const session = ctx.resolveSession(r);
      const domainReq = parsePermissionRequest(r);
      const domainResp = await session.callbacks.onRequestPermission(domainReq);
      return formatPermissionOutcome(domainResp, domainReq.options);
    },

    async readTextFile(p) {
      const session = ctx.resolveSession(p);
      return handleFsReadTextFile(
        { path: p.path, line: p.line ?? undefined, limit: p.limit ?? undefined },
        session.cwd,
        session.additionalDirectories,
      );
    },

    async writeTextFile(p) {
      const session = ctx.resolveSession(p);
      return handleFsWriteTextFile(
        { path: p.path, content: p.content },
        session.cwd,
        session.additionalDirectories,
      );
    },

    async createTerminal(p) {
      const session = ctx.resolveSession(p);
      const env: Record<string, string> = {};
      if (p.env) {
        for (const v of p.env) env[v.name] = v.value;
      }
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
      session.onTerminalCreated?.(res.terminalId);
      return res;
    },

    terminalOutput(p) {
      return toPromise(() => {
        ctx.resolveSession(p);
        return handleTerminalOutput(p, terminalManager, logger);
      });
    },

    releaseTerminal(p) {
      return toPromise(() => {
        ctx.resolveSession(p);
        return handleTerminalRelease(p, terminalManager, logger);
      });
    },

    waitForTerminalExit(p) {
      ctx.resolveSession(p);
      return handleTerminalWaitForExit(p, terminalManager, logger);
    },

    killTerminal(p) {
      return toPromise(() => {
        ctx.resolveSession(p);
        return handleTerminalKill(p, terminalManager, logger);
      });
    },

    async createElicitation(p) {
      const request = projectElicitationRequest(p);
      if (!request) return { action: 'decline' };

      let session: ClientSessionContext;
      try {
        session = ctx.resolveSession(
          request.sessionId ? { sessionId: request.sessionId } : undefined,
        );
      } catch (err) {
        logger.debug({ err, mode: p.mode }, 'Declining ACP elicitation without a session context');
        return { action: 'decline' };
      }

      if (!session.callbacks.onRequestElicitation) return { action: 'decline' };

      const response = await session.callbacks.onRequestElicitation(request);
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

    async extMethod(method, params) {
      logger.debug({ method, params }, 'ACP extension method');
      if (typeof method !== 'string') {
        throw RequestError.invalidRequest(undefined, 'Extension method name must be a string');
      }
      return (await extensionRouter.request(method, params)) as Record<string, unknown>;
    },

    async extNotification(method, rawParams) {
      try {
        if (typeof method !== 'string' || !method.startsWith('_')) return;
        logger.debug({ method, params: rawParams }, 'ACP extension notification');
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
