import type { ChildProcess } from 'node:child_process';
import type {
  ClientCapabilities,
  ClientSideConnection,
  McpServer,
  PermissionOptionKind,
  StopReason,
} from '@agentclientprotocol/sdk';
import type { ACPEventDbRow } from '../db/zod-schemas.js';
import type {
  AuthMethod,
  ThinkingEffort,
  ACPConfigOption,
  SessionMetrics,
  ElicitationRequest,
  ElicitationResponse,
  SessionStatus,
} from '@agentctl/shared';

/**
 * Minimal event-store surface used by the ACP layer. Implemented by
 * SessionEventStore. Keeps acp/ decoupled from session/event-store.
 */
export interface SessionEventStoreLike {
  append(
    sessionId: string,
    type: string,
    data: unknown,
    parentEventId?: number | null,
    metadata?: unknown,
  ): Promise<number>;
  getEvent(eventId: number): Promise<{ id: number; type: string; data: unknown } | null>;
  update(eventId: number, data: unknown, metadata?: unknown): Promise<void>;
  updateSilently(eventId: number, data: unknown, metadata?: unknown): Promise<void>;
  publishTransient(event: ACPEventDbRow, delta?: string): void;
}

/**
 * Minimal status-transition surface used by the ACP layer. Implemented by
 * SessionStateMachine. Keeps acp/ decoupled from session/state-machine.
 */
/** Minimal git-snapshot surface used for turn metadata. */
export interface SnapshotServiceLike {
  track(cwd: string): Promise<string | undefined>;
  getTurnChanges?(
    projectPath: string,
    fromHash: string,
    toHash?: string,
  ): Promise<{
    files: Array<{
      path: string;
      additions: number;
      deletions: number;
      status: 'added' | 'modified' | 'deleted';
    }>;
    totalAdditions: number;
    totalDeletions: number;
  }>;
}

export interface SessionStatusTransitioner {
  transitionTo(
    sessionId: string,
    targetState: SessionStatus,
    context?: Record<string, unknown>,
  ): Promise<void>;
  getSnapshotService?(): SnapshotServiceLike | undefined;
}

/**
 * Abstract connection surface decoupling core domain services from concrete ACP SDK connection classes.
 */
export interface IAcpClientConnection {
  initialize(params?: unknown): Promise<unknown>;
  newSession(params?: unknown): Promise<unknown>;
  authenticate(params?: unknown): Promise<unknown>;
  loadSession?(params?: unknown): Promise<unknown>;
  resumeSession?(params?: unknown): Promise<unknown>;
  closeSession?(params?: unknown): Promise<unknown>;
  deleteSession?(params?: unknown): Promise<unknown>;
  cancel?(params?: unknown): Promise<unknown>;
  prompt?(params?: unknown): Promise<unknown>;
  setSessionConfigOption?(params?: unknown): Promise<unknown>;
  setSessionMode?(params?: unknown): Promise<unknown>;
  unstable_forkSession?(params?: unknown): Promise<unknown>;
  logout?(params?: unknown): Promise<unknown>;
  extMethod?(method: string, params?: unknown): Promise<unknown>;
  listSessions?(params?: unknown): Promise<unknown>;
  closed: Promise<void>;
}

export interface ACPConnectionHandle {
  child: ChildProcess;
  connection: IAcpClientConnection;
}

export interface AgentStreamTransport {
  stdin: WritableStream<Uint8Array>;
  stdout: ReadableStream<Uint8Array>;
  closed: Promise<void>;
  child: ChildProcess;
  isAlive: boolean;
  kill(signal?: NodeJS.Signals | number): void;
}

export interface DomainPermissionRequest {
  permissionId: string;
  toolCall: {
    name: string;
    arguments?: Record<string, unknown>;
    toolCallId?: string;
  };
  options?: { optionId: string; label?: string; kind?: PermissionOptionKind }[];
  description?: string;
}

export interface DomainPermissionResponse {
  allowed: boolean;
  optionId?: string;
}

export interface CacheStorage {
  get(key: string): Promise<AgentProbeResult | null>;
  set(key: string, value: AgentProbeResult): Promise<void>;
  delete?(key: string): Promise<void>;
  clear?(): Promise<void>;
}

export interface ToolCallContent {
  type: 'content' | 'diff' | 'terminal';
  content?: { type: string; text?: string; [key: string]: unknown };
  path?: string;
  oldText?: string | null;
  newText?: string;
  terminalId?: string;
  [key: string]: unknown;
}

export type DomainAgentEvent = (
  | { type: 'text'; text: string }
  | { type: 'thought'; text: string }
  | {
      type: 'tool_call';
      call: {
        name: string;
        arguments?: Record<string, unknown>;
        toolCallId?: string;
        title?: string;
        status?: string;
        kind?: string;
        locations?: { path?: string; line?: number }[];
        content?: ToolCallContent[];
        rawInput?: unknown;
        rawOutput?: unknown;
      };
      isUpdate: boolean;
    }
  | { type: 'status'; status: string; title?: string }
  | {
      type: 'usage_update';
      used: number;
      size: number;
      cost?: {
        amount: number;
        currency: string;
      };
    }
  | {
      type: 'available_commands_update';
      commands: {
        name: string;
        description: string;
        input?: {
          hint: string;
        };
        category?: string;
      }[];
    }
  | {
      type: 'plan_update';
      plan: {
        name: string;
        status: 'pending' | 'in_progress' | 'completed';
        isCompleted: boolean;
        priority?: 'high' | 'medium' | 'low';
      }[];
    }
  | {
      type: 'mode_update';
      modeId: string;
    }
  | {
      type: 'terminal_created';
      terminalId: string;
      command: string;
    }
  | {
      type: 'terminal_output';
      terminalId: string;
      data: string;
    }
  | {
      type: 'terminal_exit';
      terminalId: string;
      code: number | null;
    }
  | {
      type: 'session_info_update';
      title?: string | null;
      updatedAt?: string | null;
    }
  | {
      type: 'config_option_update';
      configOptions: ACPConfigOption[];
    }
  | {
      type: 'metrics_update';
      metrics: SessionMetrics;
    }
) & { _meta?: Record<string, unknown> };

export interface PromptResult {
  stopReason: StopReason;
  usage?: Record<string, unknown> | null;
  userMessageId?: string | null;
}

export interface McpGatewayLike {
  getTools(): Promise<{ name: string; inputSchema?: Record<string, unknown> }[]>;
  callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown>;
}

export interface AgentRuntimeHandle {
  acpSessionId: string | null;
  /**
   * How the active ACP session was established. A fallback session is a fresh
   * context and must receive locally persisted conversation history.
   */
  sessionCreationKind?: 'new' | 'loaded' | 'resumed' | 'fallback_new';
  historyRestored?: boolean;
  closed: Promise<void>;
  onProcessError(handler: (err: Error) => void): void;
  onProcessExit(handler: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  prompt(
    text: string,
    attachments?: { filePath: string; mimeType: string }[],
    embeddedContext?: string,
  ): Promise<PromptResult>;
  authenticate(methodId: string): Promise<void>;
  cancel(): Promise<void>;
  stop(): Promise<void>;
  updateModel?(modelId: string): Promise<void>;
  updateConfigOption?(configId: string, value: string | boolean): Promise<ACPConfigOption[]>;
  setMode?(modeId: string): Promise<void>;
  availableModes?: string[];
  deleteSession?(acpSessionId: string): Promise<void>;
  listSessions?(params?: {
    cwd?: string;
    cursor?: string;
  }): Promise<{ sessions: unknown[]; nextCursor?: string }>;
  logout?(): Promise<void>;
  writeTerminalInput?(terminalId: string, data: string): boolean;
  /** Fork the agent-side session. Returns the new acp session id, or null when unsupported. */
  forkSession?(acpSessionId: string): Promise<string | null>;
}

export interface RuntimeOptions {
  providerId?: string;
  localSessionId?: string;
  cwd: string;
  env?: Record<string, string>;
  selectedModel?: string;
  selectedThinkingEffort?: ThinkingEffort;
  supportsDynamicModel?: boolean;
  supportsDynamicConfig?: boolean;
  resolvedThinkingConfigId?: string;
  resolvedModelConfigId?: string;
  existingAgentSessionId?: string | null;
  mcpServers?: McpServer[];
  additionalDirectories?: string[];
  mcpGateway?: McpGatewayLike;
}

export interface SessionCallbacks {
  onEvent: (event: DomainAgentEvent) => Promise<void> | void;
  onRequestPermission: (request: DomainPermissionRequest) => Promise<DomainPermissionResponse>;
  onRequestElicitation?: (request: ElicitationRequest) => Promise<ElicitationResponse>;
  /** Agent notified that it completed an elicitation; client should release any pending state. */
  onElicitationCompleted?: (elicitationId: string) => Promise<void> | void;
}

export interface AgentProbeResult {
  status: 'ready' | 'needs_auth';
  configOptions: ACPConfigOption[];
  authMethods: AuthMethod[];
  supportsDynamicModel: boolean;
  supportsDynamicConfig: boolean;
  modes?: string[];
  supportsLogout?: boolean;
}

export interface AgentRuntime {
  execute(
    command: string,
    args: string[],
    options: RuntimeOptions,
    callbacks: SessionCallbacks,
  ): Promise<AgentRuntimeHandle>;

  probe(command: string, args: string[], env?: Record<string, string>): Promise<AgentProbeResult>;

  deleteAgentSession?(
    command: string,
    args: string[],
    env: Record<string, string> | undefined,
    acpSessionId: string,
  ): Promise<void>;

  invalidateProbeCache?(
    command: string,
    args: string[],
    env?: Record<string, string>,
  ): Promise<void>;
}

export class AuthRequiredError extends Error {
  constructor(
    message: string,
    public connection: IAcpClientConnection,
    public child: ChildProcess,
    public configOptions: ACPConfigOption[] = [],
  ) {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

export interface IConnectionManager {
  getProviderIdByCommand(command: string): string | undefined;
  getConnection(providerId: string): Promise<{
    child: ChildProcess;
    transport: AgentStreamTransport;
    connection: ClientSideConnection;
    supportsResumeSession?: boolean;
    supportsCloseSession?: boolean;
    supportsDeleteSession?: boolean;
    supportsListSessions?: boolean;
    supportsAdditionalDirectories?: boolean;
    supportsLoadSession?: boolean;
    supportsImage?: boolean;
    supportsAudio?: boolean;
    supportsEmbeddedContext?: boolean;
  }>;
  closeSession(providerId: string, sessionId: string): Promise<void>;
  writeTerminalInput(terminalId: string, data: string): boolean;
  registerActiveSession(
    acpSessionId: string,
    session: {
      acpSessionId: string;
      localSessionId: string;
      options: RuntimeOptions;
      callbacks: SessionCallbacks;
    },
    providerId?: string,
  ): void;
  unregisterActiveSession?(acpSessionId: string): void;
}

export interface AcpParsedCapabilities {
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
