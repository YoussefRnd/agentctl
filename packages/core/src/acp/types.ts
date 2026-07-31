import type { ChildProcess } from 'node:child_process';
import type { ClientSideConnection, McpServer } from '@agentclientprotocol/sdk';
import type {
  AuthMethod,
  ThinkingEffort,
  ACPConfigOption,
  SessionMetrics,
  ElicitationRequest,
  ElicitationResponse,
} from '@agentctl/shared';

export interface ACPConnectionHandle {
  child: ChildProcess;
  connection: Pick<
    ClientSideConnection,
    'initialize' | 'newSession' | 'authenticate' | 'closed'
  > & {
    logout?: (params: Record<string, unknown>) => Promise<unknown>;
    sendRequest?: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  };
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
  options?: { optionId: string; label?: string }[];
  description?: string;
}

export interface DomainPermissionResponse {
  allowed: boolean;
  optionId?: string;
}

export interface CacheStorage {
  get(key: string): Promise<AgentProbeResult | null>;
  set(key: string, value: AgentProbeResult): Promise<void>;
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
        rawInput?: Record<string, unknown>;
        rawOutput?: Record<string, unknown>;
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
  stopReason: string;
  usage?: Record<string, unknown> | null;
  userMessageId?: string | null;
}

export interface AgentRuntimeHandle {
  acpSessionId: string | null;
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
}

export interface RuntimeOptions {
  providerId?: string;
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
  mcpGateway?: unknown;
}

export interface SessionCallbacks {
  onEvent: (event: DomainAgentEvent) => Promise<void> | void;
  onRequestPermission: (request: DomainPermissionRequest) => Promise<DomainPermissionResponse>;
  onRequestElicitation?: (request: ElicitationRequest) => Promise<ElicitationResponse>;
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
}

export class AuthRequiredError extends Error {
  constructor(
    message: string,
    public connection: ClientSideConnection,
    public child: ChildProcess,
    public configOptions: ACPConfigOption[] = [],
  ) {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

export interface PermissionToolCall {
  name?: string;
  toolCallId?: string;
  kind?: string;
  title?: string;
  locations?: { path?: string }[];
  arguments?: Record<string, unknown>;
  rawInput?: unknown;
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
}

export interface AcpParsedCapabilities {
  supportsResumeSession: boolean;
  supportsCloseSession: boolean;
  supportsDeleteSession: boolean;
  supportsListSessions: boolean;
  supportsAdditionalDirectories: boolean;
  supportsLoadSession: boolean;
  supportsEmbeddedContext: boolean;
}

export interface InitializeAcpConnectionOptions {
  clientInfo?: { name: string; title?: string; version: string };
  clientCapabilities?: Record<string, unknown>;
  timeoutMs?: number;
  transport?: AgentStreamTransport;
}
