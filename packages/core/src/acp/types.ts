import type { ClientCapabilities } from '@agentclientprotocol/sdk';
import type { AgentDescriptor } from '../agent/types.js';
import type { AgentStreamTransport } from './transport/acp-process-lifecycle.js';

export type {
  AgentConfigOption,
  AgentDescriptor,
  AgentDriver,
  AgentMcpGateway,
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentPromptResult,
  AgentSession,
  AgentSessionCallbacks,
  AgentSessionHistory,
  AgentSessionIntent,
  AgentSessionOptions,
  AgentStopReason,
  AgentToolCallContent,
  AgentUpdate,
  AgentUsage,
} from '../agent/types.js';

export interface CacheStorage {
  get(key: string): Promise<AgentDescriptor | null>;
  set(key: string, value: AgentDescriptor): Promise<void>;
  delete?(key: string): Promise<void>;
  clear?(): Promise<void>;
}

export interface AcpParsedCapabilities {
  supportsForkSession: boolean;
  supportsResumeSession: boolean;
  supportsCloseSession: boolean;
  supportsDeleteSession: boolean;
  supportsListSessions: boolean;
  supportsAdditionalDirectories: boolean;
  supportsLoadSession: boolean;
  supportsImage: boolean;
  supportsAudio: boolean;
  supportsEmbeddedContext: boolean;
  supportsMcpHttp?: boolean;
  supportsMcpSse?: boolean;
  supportsMcpAcp?: boolean;
}

export interface InitializeAcpConnectionOptions {
  clientInfo?: { name: string; title?: string; version: string };
  clientCapabilities?: ClientCapabilities;
  timeoutMs?: number;
  transport?: AgentStreamTransport;
}
