import type { McpServer } from '@agentclientprotocol/sdk';
import { assertAcpAbsolutePath } from './file-system.js';

export function assertAcpSessionPaths(cwd: string, additionalDirectories?: string[]): void {
  assertAcpAbsolutePath(cwd);
  additionalDirectories?.forEach(assertAcpAbsolutePath);
}

export interface BaseSessionParamsOptions {
  cwd: string;
  mcpServers?: McpServer[];
  additionalDirectories?: string[];
  supportsAdditionalDirectories?: boolean;
  supportsMcpHttp?: boolean;
  supportsMcpSse?: boolean;
  supportsMcpAcp?: boolean;
}

export function buildBaseSessionParams(options: BaseSessionParamsOptions): {
  cwd: string;
  mcpServers: McpServer[];
  additionalDirectories?: string[];
} {
  assertAcpSessionPaths(
    options.cwd,
    options.supportsAdditionalDirectories ? options.additionalDirectories : undefined,
  );
  return {
    cwd: options.cwd,
    mcpServers: (options.mcpServers ?? []).filter((server) => {
      if (!('type' in server)) return true;
      if (server.type === 'http') return options.supportsMcpHttp === true;
      if (server.type === 'sse') return options.supportsMcpSse === true;
      if (server.type === 'acp') return options.supportsMcpAcp === true;
      return true;
    }),
    ...(options.supportsAdditionalDirectories && options.additionalDirectories
      ? { additionalDirectories: options.additionalDirectories }
      : {}),
  };
}
