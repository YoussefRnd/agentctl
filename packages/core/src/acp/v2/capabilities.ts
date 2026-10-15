import {
  PROTOCOL_VERSION,
  type AgentCapabilities,
  type InitializeResponse,
  type NewSessionRequest,
  type SessionConfigOption,
} from '@agentclientprotocol/sdk/experimental/v2';
import type { AgentConfigOption } from '@agentctl/shared';
import { createCapabilitySnapshot, findAgentConfigOption } from '@agentctl/shared';
import type {
  AgentDescriptor,
  AgentInspectionOptions,
  AgentSessionOptions,
} from '../../agent/types.js';
import { projectAuthMethods } from '../protocol/auth-methods.js';
import { projectV2ConfigOption } from './events.js';

export function productConfigOptions(options?: SessionConfigOption[]): AgentConfigOption[] {
  return (options ?? [])
    .map(projectV2ConfigOption)
    .filter((option): option is AgentConfigOption => option !== null);
}

export function descriptorFromInitialization(
  initialization: InitializeResponse,
  configOptions: AgentConfigOption[],
  options?: AgentInspectionOptions,
): AgentDescriptor {
  const authMethods = projectAuthMethods(initialization.authMethods ?? [], 2);
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

export function advertised(capabilities: AgentCapabilities | undefined): {
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

export function supportedMcpServers(
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
