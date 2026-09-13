import { RequestError } from '@agentclientprotocol/sdk';
import type { Logger } from '../../logger.js';
import type { AgentMcpGateway } from '../../agent/types.js';
import { handleBuiltinBash, handleTerminalWrite } from './terminals.js';
import type { TerminalManager } from './terminal-manager.js';

export interface ExtensionSessionContext {
  cwd: string;
  additionalDirectories?: string[];
}

export interface ExtensionRouterContext {
  terminalManager: TerminalManager;
  logger: Logger;
  mcpGateway?: AgentMcpGateway;
  resolveSession(params?: { sessionId?: string }): ExtensionSessionContext;
  publishStatus(sessionId: string, status: string): Promise<void> | void;
}

type ExtensionParams = Record<string, unknown>;
type ExtensionRequestHandler = (params: ExtensionParams) => Promise<unknown>;
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
  request(method: string, rawParams: unknown): Promise<unknown>;
  notify(method: string, rawParams: unknown): Promise<void>;
} {
  const requestRoutes = new Map<string, ExtensionRequestHandler>([
    [
      '_agentctl.dev/builtin/bash',
      async (params) => {
        const session = ctx.resolveSession({
          sessionId: optionalString(params, 'sessionId'),
        });
        return handleBuiltinBash(
          {
            command: optionalString(params, 'command') ?? '',
            args: optionalStringArray(params, 'args'),
            pty: typeof params.pty === 'boolean' ? params.pty : undefined,
            input: optionalString(params, 'input'),
            cwd: optionalString(params, 'cwd'),
          },
          ctx.terminalManager,
          session.cwd,
          ctx.logger,
          session.additionalDirectories,
        );
      },
    ],
    [
      '_agentctl.dev/terminal/write',
      async (params) =>
        handleTerminalWrite(
          {
            terminalId: requiredString(params, 'terminalId'),
            data: requiredString(params, 'data'),
          },
          ctx.terminalManager,
          ctx.logger,
        ),
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
    async request(method, rawParams) {
      if (!method.startsWith('_')) throw RequestError.methodNotFound(method);
      const params = paramsRecord(rawParams);
      const handler = requestRoutes.get(method);
      if (handler) return handler(params);

      const mcpPrefix = '_agentctl.dev/mcp/';
      if (ctx.mcpGateway && method.startsWith(mcpPrefix)) {
        const qualifiedToolName = method.slice(mcpPrefix.length);
        const [serverId, ...toolNameParts] = qualifiedToolName.split('__');
        const toolName = toolNameParts.join('__');
        if (!serverId || !toolName) {
          throw RequestError.invalidParams(undefined, `Invalid MCP extension method: ${method}`);
        }
        ctx.logger.info({ serverId, toolName }, 'Routing ACP extension to MCP gateway');
        return ctx.mcpGateway.callTool(serverId, toolName, params);
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
