import type {
  Client,
  CompleteElicitationNotification,
  ElicitationContentValue,
} from '@agentclientprotocol/sdk';
import type { ElicitationRequest } from '@agentctl/shared';
import type { Logger } from '../../logger.js';
import type { McpGatewayLike, SessionCallbacks } from '../types.js';
import { parseNotificationToEvents } from './events.js';
import { parsePermissionRequest, formatPermissionOutcome } from './permissions.js';
import { handleFsReadTextFile, handleFsWriteTextFile } from './file-system.js';
import {
  handleBuiltinBash,
  handleTerminalCreate,
  handleTerminalKill,
  handleTerminalOutput,
  handleTerminalRelease,
  handleTerminalWaitForExit,
  handleTerminalWrite,
} from './terminals.js';
import type { TerminalManager } from './terminal-manager.js';

/**
 * Per-session context resolved from an incoming ACP request.
 * The per-connection runtime path always resolves to the single active
 * session; the persistent path resolves by sessionId.
 */
export interface ClientSessionContext {
  callbacks: SessionCallbacks;
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
  mcpGateway?: McpGatewayLike;
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
 * Anything else silently falls through to `extMethod` and returns `{}`.
 */
export function createClientHandlers(ctx: ClientHandlerContext): Client {
  const { terminalManager, logger, mcpGateway } = ctx;

  return {
    async sessionUpdate(n) {
      try {
        const session = ctx.resolveSession(n);
        for (const event of parseNotificationToEvents(n)) {
          await session.callbacks.onEvent(event);
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
      return formatPermissionOutcome(domainResp);
    },

    readTextFile(p) {
      return toPromise(() => {
        const session = ctx.resolveSession(p);
        return handleFsReadTextFile(
          { path: p.path, line: p.line ?? undefined, limit: p.limit ?? undefined },
          session.cwd,
          session.additionalDirectories,
        );
      });
    },

    writeTextFile(p) {
      return toPromise(() => {
        const session = ctx.resolveSession(p);
        return handleFsWriteTextFile(
          { path: p.path, content: p.content },
          session.cwd,
          session.additionalDirectories,
        );
      });
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
        session.callbacks.onEvent,
        session.additionalDirectories,
      );
      session.onTerminalCreated?.(res.terminalId);
      return res;
    },

    terminalOutput(p) {
      return toPromise(() => handleTerminalOutput(p, terminalManager, logger));
    },

    releaseTerminal(p) {
      return toPromise(() => handleTerminalRelease(p, terminalManager, logger));
    },

    waitForTerminalExit(p) {
      return handleTerminalWaitForExit(p, terminalManager, logger);
    },

    killTerminal(p) {
      return toPromise(() => handleTerminalKill(p, terminalManager, logger));
    },

    async createElicitation(p: Record<string, unknown>) {
      const session = ctx.resolveSession(p);
      const modeObj = p.mode as { type?: string } | undefined;
      const req = {
        id: typeof p.id === 'string' ? p.id : `el-${String(Date.now())}`,
        mode: modeObj?.type === 'url' || typeof p.url === 'string' ? 'url' : 'form',
        form: p.form as ElicitationRequest['form'],
        url: p.url as ElicitationRequest['url'],
      } as ElicitationRequest;
      if (session.callbacks.onRequestElicitation) {
        const resp = await session.callbacks.onRequestElicitation(req);
        if (resp.action === 'submit') {
          const content: Record<string, ElicitationContentValue> = {};
          for (const [key, value] of Object.entries(resp.values ?? {})) {
            if (value === null || value === undefined) continue;
            if (
              typeof value === 'string' ||
              typeof value === 'number' ||
              typeof value === 'boolean'
            ) {
              content[key] = value;
            } else if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
              content[key] = value;
            }
          }
          return { action: 'accept', content };
        }
        return { action: 'cancel' };
      }
      return { action: 'cancel' };
    },

    async completeElicitation(n: CompleteElicitationNotification) {
      const raw = n as CompleteElicitationNotification & { sessionId?: unknown };
      const meta = n._meta as { sessionId?: unknown } | null | undefined;
      const sessionId =
        typeof raw.sessionId === 'string'
          ? raw.sessionId
          : typeof meta?.sessionId === 'string'
            ? meta.sessionId
            : undefined;
      let session: ClientSessionContext;
      try {
        session = ctx.resolveSession(sessionId ? { sessionId } : undefined);
      } catch {
        logger.debug(
          { elicitationId: n.elicitationId },
          'Could not resolve session for elicitation completion',
        );
        return;
      }
      await session.callbacks.onElicitationCompleted?.(n.elicitationId);
    },

    async extMethod(method, params) {
      logger.debug({ method, params }, 'ACP extension method');
      if (typeof method !== 'string') {
        return {};
      }
      // The SDK never dispatches `builtin/bash`/`terminal/write` as native
      // client methods; they arrive here as extension methods.
      if (method === 'builtin/bash') {
        return toPromise(() => {
          // extMethod params are unvalidated and may be undefined at runtime.
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          const bp = params ?? {};
          const session = ctx.resolveSession(bp);
          return handleBuiltinBash(
            {
              command: typeof bp.command === 'string' ? bp.command : '',
              args: Array.isArray(bp.args) ? (bp.args as string[]) : undefined,
              pty: typeof bp.pty === 'boolean' ? bp.pty : undefined,
              input: typeof bp.input === 'string' ? bp.input : undefined,
              cwd: typeof bp.cwd === 'string' ? bp.cwd : undefined,
            },
            terminalManager,
            session.cwd,
            logger,
            session.additionalDirectories,
          );
        });
      }
      if (method === 'terminal/write') {
        return toPromise(() =>
          handleTerminalWrite(
            params as { terminalId: string; data: string },
            terminalManager,
            logger,
          ),
        );
      }
      if (mcpGateway && method.includes('__')) {
        const parts = method.split('__');
        const serverId = parts[0];
        const toolName = parts.slice(1).join('__');
        // The SDK may pass undefined params for request methods without args.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        const args = params ?? {};
        logger.info({ serverId, toolName, params }, 'Routing tool call to client-side MCP gateway');
        return (await mcpGateway.callTool(serverId, toolName, args)) as Record<string, unknown>;
      }
      return {};
    },

    async extNotification(method, rawParams) {
      try {
        const params = rawParams as Record<string, unknown> | undefined;
        logger.debug({ method, params }, 'ACP extension notification');
        if (params && method.includes('session') && 'sessionId' in params) {
          const session = ctx.resolveSession({ sessionId: String(params.sessionId) });
          const update = params.update as { sessionUpdate?: string } | undefined;
          if (update?.sessionUpdate) {
            await session.callbacks.onEvent({ type: 'status', status: update.sessionUpdate });
          }
        }
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
