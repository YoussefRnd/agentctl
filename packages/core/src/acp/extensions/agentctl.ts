import { RequestError } from '@agentclientprotocol/sdk';
import type { AgentMcpGateway, AgentSessionCallbacks } from '../../agent/types.js';
import type { Logger } from '../../logger.js';
import {
  authorizeClientOperation,
  type ClientAuthorizationContext,
} from '../protocol/client-authorization.js';
import type { TerminalManager } from '../protocol/terminal-manager.js';
import { handleBuiltinBash, handleTerminalWrite } from '../protocol/terminals.js';
import { resolveAllowedPath } from '../../security/path-security.js';

export interface ExtensionSessionContext extends ClientAuthorizationContext {
  onTerminalCreated?(terminalId: string, callbacks: AgentSessionCallbacks): void;
}

export interface ExtensionRouterContext {
  terminalManager: TerminalManager;
  logger: Logger;
  mcpGateway?: AgentMcpGateway;
  resolveSession(params?: { sessionId?: string }): ExtensionSessionContext;
  publishStatus(sessionId: string, status: string): Promise<void> | void;
  assertTerminalOwner(session: ExtensionSessionContext, terminalId: string): void;
  registerTerminal(session: ExtensionSessionContext, terminalId: string): void;
}

type ExtensionParams = Record<string, unknown>;
type ExtensionRequestHandler = (params: ExtensionParams, signal?: AbortSignal) => Promise<unknown>;
type ExtensionNotificationHandler = (params: ExtensionParams) => Promise<void>;

function paramsRecord(value: unknown): ExtensionParams {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw RequestError.invalidParams(undefined, 'Extension params must be an object');
  }
  return value as ExtensionParams;
}

function requiredString(params: ExtensionParams, key: string): string {
  const value = params[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw RequestError.invalidParams(
      undefined,
      `Extension param ${key} must be a non-empty string`,
    );
  }
  return value;
}

function optionalString(params: ExtensionParams, key: string): string | undefined {
  const value = params[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw RequestError.invalidParams(undefined, `Extension param ${key} must be a string`);
  }
  return value;
}

function optionalStringArray(params: ExtensionParams, key: string): string[] | undefined {
  const value = params[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw RequestError.invalidParams(undefined, `Extension param ${key} must be a string array`);
  }
  return value;
}

/**
 * The complete allowlist for ACP v1 extensions understood by agentctl.
 * Parsing and protocol method names terminate here.
 */
export function createExtensionRouter(ctx: ExtensionRouterContext): {
  request(method: string, rawParams: unknown, signal?: AbortSignal): Promise<unknown>;
  notify(method: string, rawParams: unknown): Promise<void>;
} {
  const requestRoutes = new Map<string, ExtensionRequestHandler>([
    [
      '_agentctl.dev/builtin/bash',
      async (params, signal) => {
        const session = ctx.resolveSession({
          sessionId: optionalString(params, 'sessionId'),
        });
        const command = requiredString(params, 'command');
        const args = optionalStringArray(params, 'args');
        const input = optionalString(params, 'input');
        const requestedCwd = optionalString(params, 'cwd');
        const cwd = resolveAllowedPath(
          requestedCwd ?? session.cwd,
          session.cwd,
          session.additionalDirectories,
        );
        await authorizeClientOperation(
          session,
          {
            name: 'builtin/bash',
            kind: 'execute',
            arguments: { command, args: args ?? [], cwd, env: {}, ...(input ? { input } : {}) },
          },
          `Run ${command}`,
          signal,
        );
        const result = await handleBuiltinBash(
          {
            command,
            args,
            input,
            cwd: requestedCwd,
            pty: typeof params.pty === 'boolean' ? params.pty : undefined,
          },
          ctx.terminalManager,
          session.cwd,
          ctx.logger,
          session.additionalDirectories,
          signal,
        );
        if (result.terminalId) ctx.registerTerminal(session, result.terminalId);
        return result;
      },
    ],
    [
      '_agentctl.dev/terminal/write',
      async (params, signal) => {
        const terminalId = requiredString(params, 'terminalId');
        const data = requiredString(params, 'data');
        const session = ctx.resolveSession({ sessionId: optionalString(params, 'sessionId') });
        ctx.assertTerminalOwner(session, terminalId);
        await authorizeClientOperation(
          session,
          {
            name: 'terminal/write',
            kind: 'execute',
            arguments: { terminalId, input: data, cwd: session.cwd },
          },
          'Send input to the running terminal',
          signal,
        );
        return handleTerminalWrite({ terminalId, data }, ctx.terminalManager, ctx.logger);
      },
    ],
  ]);

  const notificationRoutes = new Map<string, ExtensionNotificationHandler>([
    [
      '_agentctl.dev/session/update',
      async (params) => {
        const sessionId = requiredString(params, 'sessionId');
        const update = paramsRecord(params.update);
        const status = optionalString(update, 'sessionUpdate');
        if (status) await ctx.publishStatus(sessionId, status);
      },
    ],
  ]);

  return {
    async request(method, rawParams, signal) {
      if (!method.startsWith('_')) throw RequestError.methodNotFound(method);
      const params = paramsRecord(rawParams);
      const handler = requestRoutes.get(method);
      if (handler) return handler(params, signal);

      const mcpPrefix = '_agentctl.dev/mcp/';
      if (ctx.mcpGateway && method.startsWith(mcpPrefix)) {
        const qualifiedToolName = method.slice(mcpPrefix.length);
        const [serverId, ...toolNameParts] = qualifiedToolName.split('__');
        const toolName = toolNameParts.join('__');
        if (!serverId || !toolName) {
          throw RequestError.invalidParams(undefined, `Invalid MCP extension method: ${method}`);
        }
        const session = ctx.resolveSession({ sessionId: optionalString(params, 'sessionId') });
        const { sessionId: _sessionId, ...args } = params;
        await authorizeClientOperation(
          session,
          {
            name: qualifiedToolName,
            kind: 'other',
            arguments: args,
          },
          `Call MCP tool ${qualifiedToolName}`,
          signal,
        );
        ctx.logger.info({ serverId, toolName }, 'Routing ACP extension to MCP gateway');
        return ctx.mcpGateway.callTool(serverId, toolName, args);
      }

      throw RequestError.methodNotFound(method);
    },

    async notify(method, rawParams) {
      if (!method.startsWith('_')) return;
      const handler = notificationRoutes.get(method);
      if (handler) await handler(paramsRecord(rawParams));
    },
  };
}
