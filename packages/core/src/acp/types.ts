import type { ChildProcess } from 'node:child_process';
import type { AgentConnectionDiagnostic } from '../agent/diagnostics.js';
import type { ClientCapabilities, ClientSideConnection } from '@agentclientprotocol/sdk';
import type {
  AgentDescriptor,
  AgentSessionCallbacks,
  AgentSessionOptions,
} from '../agent/types.js';

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

export interface ACPConnectionHandle {
  child: ChildProcess;
  connection: ClientSideConnection;
}

export interface AgentStreamTransport {
  stdin: WritableStream<Uint8Array>;
  stdout: ReadableStream<Uint8Array>;
  closed: Promise<void>;
  child: ChildProcess;
  isAlive: boolean;
  kill(signal?: NodeJS.Signals | number): void;
}

export interface CacheStorage {
  get(key: string): Promise<AgentDescriptor | null>;
  set(key: string, value: AgentDescriptor): Promise<void>;
  delete?(key: string): Promise<void>;
  clear?(): Promise<void>;
}

export interface IConnectionManager {
  getProviderIdByCommand(command: string): string | undefined;
  getConnection(providerId: string): Promise<{
    generation?: number;
    child: ChildProcess;
    transport: AgentStreamTransport;
    connection: ClientSideConnection;
    capabilities: AcpParsedCapabilities;
  }>;
  closeSession(providerId: string, sessionId: string): Promise<void>;
  writeTerminalInput(terminalId: string, data: string): boolean;
  registerActiveSession(
    acpSessionId: string,
    session: {
      acpSessionId: string;
      localSessionId: string;
      options: AgentSessionOptions;
      callbacks: AgentSessionCallbacks;
    },
    providerId: string,
  ): void;
  unregisterActiveSession?(acpSessionId: string): void;
}

/** Complete connection lifecycle required by the application composition root. */
export interface AgentConnectionManager extends IConnectionManager {
  getConnectionDiagnostics(): AgentConnectionDiagnostic[];
  closeConnection(providerId: string): void;
  closeAll(): void;
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
}

export interface InitializeAcpConnectionOptions {
  clientInfo?: { name: string; title?: string; version: string };
  clientCapabilities?: ClientCapabilities;
  timeoutMs?: number;
  transport?: AgentStreamTransport;
}
