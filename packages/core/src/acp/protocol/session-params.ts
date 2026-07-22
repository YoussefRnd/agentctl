import type { McpServer } from '@agentclientprotocol/sdk';

export interface BaseSessionParamsOptions {
  cwd: string;
  mcpServers?: McpServer[];
  additionalDirectories?: string[];
  supportsAdditionalDirectories?: boolean;
}

export function buildBaseSessionParams(options: BaseSessionParamsOptions): {
  cwd: string;
  mcpServers: McpServer[];
  additionalDirectories?: string[];
} {
  return {
    cwd: options.cwd,
    mcpServers: options.mcpServers ?? [],
    ...(options.supportsAdditionalDirectories && options.additionalDirectories
      ? { additionalDirectories: options.additionalDirectories }
      : {}),
  };
}
