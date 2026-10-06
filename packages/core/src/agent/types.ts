import type {
  AgentConfigOption,
  AgentFeatures,
  AuthMethod,
  CapabilitySnapshot,
  ElicitationRequest,
  ElicitationResponse,
  PermissionOptionKind,
  PlanArtifact,
  PlanItem,
  FileChange,
  FilePatch,
  FileChangeStats,
  CustomModel,
  SessionMetrics,
  ThinkingEffort,
  ProviderRetryStatus,
} from '@agentctl/shared';

export type { AgentConfigOption } from '@agentctl/shared';
export type { AgentFeatures } from '@agentctl/shared';

export type AgentStopReason =
  'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled' | (string & {});

export type AgentSessionIntent =
  | { kind: 'new' }
  | { kind: 'resume'; sessionId: string; requireExisting?: boolean }
  | { kind: 'fork'; sessionId: string };

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
  subagentId?: string;
  source?: 'provider' | 'client';
  /** Preserve unfamiliar ACP subjects instead of interpreting them as commands. */
  subject?: unknown;
  toolCall: {
    name: string;
    arguments?: Record<string, unknown>;
    toolCallId?: string;
    kind?: string;
    locations?: { path?: string; line?: number }[];
    rawInput?: unknown;
  };
  options?: { optionId: string; label?: string; kind?: PermissionOptionKind | (string & {}) }[];
  description?: string;
}

export interface AgentPermissionResponse {
  allowed: boolean;
  optionId?: string;
  cancelled?: boolean;
}

export interface AgentToolCallContent {
  type: 'content' | 'diff' | 'terminal';
  content?: { type: string; text?: string; [key: string]: unknown };
  path?: string;
  oldText?: string | null;
  newText?: string;
  terminalId?: string;
  changes?: FileChange[];
  patch?: FilePatch | null;
  [key: string]: unknown;
}

export type AgentToolEffect =
  | { type: 'file_read'; path: string }
  | {
      type: 'file_modified';
      path: string;
      oldText?: string | null;
      newText?: string;
      stats?: FileChangeStats;
    }
  | { type: 'file_deleted'; path: string; stats?: FileChangeStats }
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

export interface AgentSubagentAssociation {
  subagentId: string;
  parentSessionId: string;
  title?: string | null;
  description?: string | null;
  capabilities?: Record<string, unknown> | null;
  state?: { state: string; [key: string]: unknown } | null;
  historical?: boolean;
}

export type AgentUpdate =
  | { type: 'subagent_update'; association: AgentSubagentAssociation }
  | { type: 'subagent_event'; subagentId: string; event: AgentUpdate }
  | {
      type: 'session_message';
      messageId: string;
      senderSessionId?: string;
      recipientSessionId?: string;
      content: string;
      transcriptSessionId: string;
      metadata?: Record<string, unknown> | null;
    }
  | { type: 'user_message_accepted'; messageId: string }
  | { type: 'user_message_unconfirmed' }
  | { type: 'user_text'; text: string; messageId?: string; operation?: 'append' | 'replace' }
  | { type: 'text'; text: string; messageId?: string; operation?: 'append' | 'replace' }
  | { type: 'thought'; text: string; messageId?: string; operation?: 'append' | 'replace' }
  | {
      type: 'tool_call';
      call: AgentToolCall;
      contentOperation?: 'replace' | 'append';
      clearFields?: string[];
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
      artifact?: PlanArtifact;
      removedPlanId?: string;
      plan: PlanItem[];
    }
  | { type: 'mode_update'; modeId: string }
  | { type: 'terminal_created'; terminalId: string; command: string }
  | { type: 'terminal_output'; terminalId: string; data: string; operation?: 'append' | 'replace' }
  | { type: 'terminal_exit'; terminalId: string; code: number | null }
  | {
      type: 'session_info_update';
      title?: string | null;
      updatedAt?: string | null;
      retry?: ProviderRetryStatus | null;
    }
  | { type: 'config_option_update'; configOptions: AgentConfigOption[] }
  | { type: 'metrics_update'; metrics: SessionMetrics };

export interface AgentPromptResult {
  stopReason: AgentStopReason;
  usage?: AgentUsage;
  userMessageId?: string | null;
  error?: { code: number; message: string; data?: unknown };
}

export interface AgentMcpGateway {
  getTools(): Promise<{ name: string; inputSchema?: Record<string, unknown> }[]>;
  callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown>;
}

export interface AgentSession {
  id: string | null;
  history: AgentSessionHistory;
  /** Options advertised for this live session, after any initial model selection. */
  configOptions?: AgentConfigOption[];
  closed: Promise<void>;
  onError(handler: (err: Error) => void): void;
  onClose(
    handler: (detail: { code: number | null; signal: string | null; message?: string }) => void,
  ): void;
  prompt(
    text: string,
    attachments?: { filePath: string; mimeType: string }[],
    embeddedContext?: string,
  ): Promise<AgentPromptResult>;
  authenticate(methodId: string): Promise<void>;
  cancel(): Promise<void>;
  close(): Promise<void>;
  updateModel?(modelId: string): Promise<AgentConfigOption[] | void>;
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
  customModels?: CustomModel[];
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
  onRequestPermission: (
    request: AgentPermissionRequest,
    signal?: AbortSignal,
  ) => Promise<AgentPermissionResponse>;
  onRequestElicitation?: (
    request: ElicitationRequest,
    signal?: AbortSignal,
  ) => Promise<ElicitationResponse>;
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
  snapshot?: CapabilitySnapshot;
}

export interface AgentInspectionOptions {
  providerVersion?: string;
}

export interface AgentAuthenticationOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  onBrowserRequest?: (request: { id: string; url: string; message: string }) => Promise<boolean>;
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
    options?: AgentInspectionOptions,
  ): Promise<AgentDescriptor>;
  listSessions?(
    command: string,
    args: string[],
    env: Record<string, string> | undefined,
    params: { cwd?: string; cursor?: string },
  ): Promise<{ sessions: unknown[]; nextCursor?: string }>;
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
    options?: AgentInspectionOptions,
  ): Promise<void>;
  authenticateProvider?(
    command: string,
    args: string[],
    env: Record<string, string> | undefined,
    methodId: string,
    options?: AgentAuthenticationOptions,
  ): Promise<void>;
  logoutProvider?(command: string, args: string[], env?: Record<string, string>): Promise<void>;
}
