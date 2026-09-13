import type {
  AgentConfigOption,
  AgentFeatures,
  AuthMethod,
  ElicitationRequest,
  ElicitationResponse,
  PermissionOptionKind,
  SessionMetrics,
  ThinkingEffort,
} from '@agentctl/shared';

export type { AgentConfigOption } from '@agentctl/shared';
export type { AgentFeatures } from '@agentctl/shared';

export type AgentStopReason =
  'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled' | (string & {});

export type AgentSessionIntent =
  { kind: 'new' } | { kind: 'resume'; sessionId: string } | { kind: 'fork'; sessionId: string };

export type AgentSessionHistory = 'fresh' | 'restored';

export interface AgentUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  thoughtTokens?: number;
  cachedReadTokens?: number;
  cachedWriteTokens?: number;
  contextLimit?: number;
  cost?: { amount: number; currency: string };
}

export type AgentMcpServer =
  | {
      type?: 'stdio';
      name: string;
      command: string;
      args: string[];
      env: Array<{ name: string; value: string }>;
    }
  | {
      type: 'http' | 'sse';
      name: string;
      url: string;
      headers: Array<{ name: string; value: string }>;
    }
  | { type: 'acp'; name: string; serverId: string };

export interface AgentPermissionRequest {
  permissionId: string;
  toolCall: {
    name: string;
    arguments?: Record<string, unknown>;
    toolCallId?: string;
  };
  options?: { optionId: string; label?: string; kind?: PermissionOptionKind }[];
  description?: string;
}

export interface AgentPermissionResponse {
  allowed: boolean;
  optionId?: string;
}

export interface AgentToolCallContent {
  type: 'content' | 'diff' | 'terminal';
  content?: { type: string; text?: string; [key: string]: unknown };
  path?: string;
  oldText?: string | null;
  newText?: string;
  terminalId?: string;
  [key: string]: unknown;
}

export type AgentToolEffect =
  | { type: 'file_read'; path: string }
  | { type: 'file_modified'; path: string; oldText?: string | null; newText?: string }
  | { type: 'file_deleted'; path: string }
  | { type: 'terminal'; terminalId: string };

export interface AgentToolCall {
  name?: string;
  arguments?: Record<string, unknown>;
  toolCallId?: string;
  title?: string;
  status?: string;
  kind?: string;
  locations?: { path?: string; line?: number }[];
  content?: AgentToolCallContent[];
  effects?: AgentToolEffect[];
  rawInput?: unknown;
  rawOutput?: unknown;
}

export type AgentUpdate =
  | { type: 'text'; text: string; messageId?: string; operation?: 'append' | 'replace' }
  | { type: 'thought'; text: string; messageId?: string; operation?: 'append' | 'replace' }
  | {
      type: 'tool_call';
      call: AgentToolCall;
      contentOperation?: 'replace' | 'append';
    }
  | { type: 'status'; status: string; title?: string }
  | {
      type: 'usage_update';
      used: number;
      size: number;
      cost?: { amount: number; currency: string };
    }
  | {
      type: 'available_commands_update';
      commands: {
        name: string;
        description: string;
        input?: { hint: string };
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
  | { type: 'mode_update'; modeId: string }
  | { type: 'terminal_created'; terminalId: string; command: string }
  | { type: 'terminal_output'; terminalId: string; data: string }
  | { type: 'terminal_exit'; terminalId: string; code: number | null }
  | { type: 'session_info_update'; title?: string | null; updatedAt?: string | null }
  | { type: 'config_option_update'; configOptions: AgentConfigOption[] }
  | { type: 'metrics_update'; metrics: SessionMetrics };

export interface AgentPromptResult {
  stopReason: AgentStopReason;
  usage?: AgentUsage;
  userMessageId?: string | null;
}

export interface AgentMcpGateway {
  getTools(): Promise<{ name: string; inputSchema?: Record<string, unknown> }[]>;
  callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown>;
}

export interface AgentSession {
  id: string | null;
  history: AgentSessionHistory;
  closed: Promise<void>;
  onError(handler: (err: Error) => void): void;
  onClose(handler: (detail: { code: number | null; signal: string | null }) => void): void;
  prompt(
    text: string,
    attachments?: { filePath: string; mimeType: string }[],
    embeddedContext?: string,
  ): Promise<AgentPromptResult>;
  authenticate(methodId: string): Promise<void>;
  cancel(): Promise<void>;
  close(): Promise<void>;
  updateModel?(modelId: string): Promise<void>;
  updateConfigOption?(configId: string, value: string | boolean): Promise<AgentConfigOption[]>;
  setMode?(modeId: string): Promise<void>;
  availableModes?: string[];
  deleteSession?(agentSessionId: string): Promise<void>;
  listSessions?(params?: {
    cwd?: string;
    cursor?: string;
  }): Promise<{ sessions: unknown[]; nextCursor?: string }>;
  logout?(): Promise<void>;
  writeTerminalInput?(terminalId: string, data: string): boolean;
}

export interface AgentSessionOptions {
  providerId?: string;
  localSessionId?: string;
  cwd: string;
  env?: Record<string, string>;
  selectedModel?: string;
  selectedThinkingEffort?: ThinkingEffort;
  features: AgentFeatures;
  resolvedThinkingConfigId?: string;
  resolvedModelConfigId?: string;
  intent: AgentSessionIntent;
  mcpServers?: AgentMcpServer[];
  additionalDirectories?: string[];
  mcpGateway?: AgentMcpGateway;
}

export interface AgentSessionCallbacks {
  onUpdate: (event: AgentUpdate) => Promise<void> | void;
  onRequestPermission: (request: AgentPermissionRequest) => Promise<AgentPermissionResponse>;
  onRequestElicitation?: (request: ElicitationRequest) => Promise<ElicitationResponse>;
  onElicitationCompleted?: (elicitationId: string) => Promise<void> | void;
}

export interface AgentDescriptor {
  status: 'ready' | 'needs_auth';
  configOptions: AgentConfigOption[];
  authMethods: AuthMethod[];
  supportsDynamicModel: boolean;
  supportsDynamicConfig: boolean;
  modes?: string[];
  supportsLogout?: boolean;
  features?: AgentFeatures;
}

export interface AgentDriver {
  startSession(
    command: string,
    args: string[],
    options: AgentSessionOptions,
    callbacks: AgentSessionCallbacks,
  ): Promise<AgentSession>;
  inspectProvider(
    command: string,
    args: string[],
    env?: Record<string, string>,
  ): Promise<AgentDescriptor>;
  deleteSession?(
    command: string,
    args: string[],
    env: Record<string, string> | undefined,
    agentSessionId: string,
  ): Promise<void>;
  invalidateProviderCache?(
    command: string,
    args: string[],
    env?: Record<string, string>,
  ): Promise<void>;
  authenticateProvider?(
    command: string,
    args: string[],
    env: Record<string, string> | undefined,
    methodId: string,
    params?: Record<string, unknown>,
  ): Promise<void>;
  logoutProvider?(command: string, args: string[], env?: Record<string, string>): Promise<void>;
}
