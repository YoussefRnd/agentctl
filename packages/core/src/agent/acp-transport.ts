import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import {
  ClientSideConnection,
  ndJsonStream,
  type McpServer,
  type Client,
  type Stream,
  type AnyMessage,
} from '@agentclientprotocol/sdk';
import type {
  RequestPermissionResponse,
  RequestPermissionRequest,
  SessionNotification,
  ContentBlock,
  NewSessionResponse,
  ResumeSessionResponse,
  LoadSessionResponse,
  SessionConfigOption,
} from '@agentclientprotocol/sdk';
import { type Logger, noopLogger } from '../logger.js';
import type { AuthMethod, ThinkingEffort, ACPConfigOption, SessionMetrics } from '@agentctl/shared';
import { TerminalManager } from './terminal-manager.js';
import type { McpGateway } from './mcp-gateway.js';

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
  kill(signal?: NodeJS.Signals | number): void;
}

export class ProcessStreamTransport implements AgentStreamTransport {
  public readonly stdin: WritableStream<Uint8Array>;
  public readonly stdout: ReadableStream<Uint8Array>;
  public readonly closed: Promise<void>;

  constructor(
    public readonly child: ChildProcess,
    private logger: Logger,
  ) {
    const stdin = child.stdin;
    const stdout = child.stdout;
    const stderr = child.stderr;

    if (!stdin || !stdout) {
      child.kill();
      throw new Error('Spawned process missing stdin/stdout');
    }

    if (stderr) {
      stderr.on('data', (data: Buffer) => {
        logger.warn(`Process stderr: ${data.toString()}`);
      });
    }

    this.stdin = Writable.toWeb(stdin) as WritableStream<Uint8Array>;
    this.stdout = Readable.toWeb(stdout) as ReadableStream<Uint8Array>;

    this.closed = new Promise<void>((resolve, reject) => {
      let resolved = false;

      const handleExit = (code: number | null, signal: NodeJS.Signals | null) => {
        if (resolved) return;
        resolved = true;
        if (code === 0 || code === null) {
          resolve();
        } else {
          reject(
            new Error(
              `Process exited with code ${String(code)}${signal ? ` and signal ${signal}` : ''}`,
            ),
          );
        }
      };

      child.on('exit', handleExit);
      child.on('error', (err) => {
        if (resolved) return;
        resolved = true;
        reject(err);
      });
    });
  }

  kill(signal: NodeJS.Signals | number = 'SIGTERM'): void {
    if (!this.child.killed) {
      this.child.kill(signal);

      if (signal === 'SIGTERM') {
        setTimeout(() => {
          if (!this.child.killed && this.child.exitCode === null) {
            this.logger.warn(
              `Process did not exit on SIGTERM, sending SIGKILL to PID ${String(this.child.pid)}`,
            );
            this.child.kill('SIGKILL');
          }
        }, 2000).unref();
      }
    }
  }
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

export class FileCacheStorage implements CacheStorage {
  constructor(private readonly manifestFilePath: string) {}

  private readManifest(): Record<string, AgentProbeResult> {
    try {
      if (fs.existsSync(this.manifestFilePath)) {
        const content = fs.readFileSync(this.manifestFilePath, 'utf8');
        return JSON.parse(content) as Record<string, AgentProbeResult>;
      }
    } catch {
      // Ignore reading errors, return empty
    }
    return {};
  }

  async get(key: string): Promise<AgentProbeResult | null> {
    const manifest = this.readManifest();
    return Promise.resolve(manifest[key] ?? null);
  }

  async set(key: string, value: AgentProbeResult): Promise<void> {
    try {
      const dir = path.dirname(this.manifestFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const manifest = this.readManifest();
      manifest[key] = value;
      fs.writeFileSync(this.manifestFilePath, JSON.stringify(manifest, null, 2), 'utf8');
    } catch {
      // Ignore write errors
    }
    return Promise.resolve();
  }
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
      }[];
    }
  | {
      type: 'plan_update';
      plan: {
        name: string;
        status: 'pending' | 'in_progress' | 'completed';
        isCompleted: boolean;
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
  updateConfigOption?(configId: string, value: string): Promise<ACPConfigOption[]>;
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
  mcpGateway?: McpGateway;
}

export interface SessionCallbacks {
  onEvent: (event: DomainAgentEvent) => Promise<void> | void;
  onRequestPermission: (request: DomainPermissionRequest) => Promise<DomainPermissionResponse>;
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

export function cleanEnv(env: Record<string, string> = {}): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }

  Object.assign(result, env);

  delete result.npm_config_engine_strict;
  delete result.npm_config_user_agent;
  delete result.npm_package_manager;
  return result;
}

export function createAgentConnection(
  command: string,
  args: string[],
  env: Record<string, string>,
  spawnImpl: typeof spawn = spawn,
): ACPConnectionHandle {
  const child = spawnImpl(command, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: cleanEnv(env),
    cwd: os.tmpdir(),
  });

  const stdin = child.stdin as typeof child.stdin | null;
  const stdout = child.stdout as typeof child.stdout | null;

  if (stdin === null || stdout === null) {
    child.kill();
    throw new Error('Spawned agent missing stdin/stdout');
  }

  const stream = ndJsonStream(
    Writable.toWeb(stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(stdout) as ReadableStream<Uint8Array>,
  );

  const connection = new ClientSideConnection(
    () => ({
      sessionUpdate() {
        return Promise.resolve();
      },
      requestPermission(request) {
        void request;
        return Promise.resolve<RequestPermissionResponse>({
          outcome: { outcome: 'selected', optionId: 'allow-once' },
        });
      },
      async 'fs.readTextFile'(p: { path: string }) {
        const absPath = path.isAbsolute(p.path) ? p.path : path.resolve(os.tmpdir(), p.path);
        if (!fs.existsSync(absPath)) {
          throw new Error(`File not found: ${absPath}`);
        }
        const content = fs.readFileSync(absPath, 'utf8');
        return Promise.resolve({ content });
      },
      async 'fs.writeTextFile'(p: { path: string; content: string }) {
        const absPath = path.isAbsolute(p.path) ? p.path : path.resolve(os.tmpdir(), p.path);
        const dir = path.dirname(absPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(absPath, p.content, 'utf8');
        return Promise.resolve({});
      },
    }),
    stream,
  );

  return { child, connection };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Timed out while ${label}`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

export function parseNotificationToEvents(notification: SessionNotification): DomainAgentEvent[] {
  const update = notification.update;
  const typeKey = update.sessionUpdate;
  const events: DomainAgentEvent[] = [];
  const _meta = (update as Record<string, unknown>)._meta as Record<string, unknown> | undefined;

  if (typeKey === 'agent_message_chunk') {
    const chunk = update as Record<string, unknown>;
    const content = chunk.content as Record<string, unknown> | undefined;
    const text = content?.text;
    if (typeof text === 'string') {
      const isThought = content?.type === 'thought' || content?.type === 'thinking';
      if (isThought) {
        events.push({ type: 'thought', text, _meta });
      } else {
        events.push({ type: 'text', text, _meta });
      }
    }
  } else if (typeKey === 'agent_thought_chunk') {
    const chunk = update as Record<string, unknown>;
    const content = chunk.content as Record<string, unknown> | undefined;
    const thought = (content?.text ?? content?.thought) as string | undefined;
    if (typeof thought === 'string') {
      events.push({ type: 'thought', text: thought, _meta });
    }
  } else if (typeKey === 'tool_call' || typeKey === 'tool_call_update') {
    const chunk = update as {
      name?: string;
      arguments?: Record<string, unknown>;
      toolCallId?: string;
      title?: string;
      status?: string;
      rawInput?: unknown;
      locations?: { path?: string }[];
      kind?: string;
    };
    const rawInput = chunk.rawInput as Record<string, unknown> | undefined;

    // Parse tool name
    let parsedName = chunk.name ?? '';
    if (!parsedName && chunk.toolCallId) {
      parsedName = chunk.toolCallId.split('__')[0];
    }
    if (!parsedName) {
      parsedName = chunk.kind ?? 'tool';
    }

    // Resolve arguments
    let parsedArgs = chunk.arguments;
    if (!parsedArgs) {
      if (rawInput && typeof rawInput === 'object') {
        if (rawInput.arguments && typeof rawInput.arguments === 'object') {
          parsedArgs = rawInput.arguments as Record<string, unknown>;
        } else {
          const rest = { ...rawInput };
          delete rest.name;
          delete rest.arguments;
          parsedArgs = rest;
        }
        if (!parsedName && typeof rawInput.name === 'string') {
          parsedName = rawInput.name;
        }
      }
    }

    // Fallback arguments for files/directories
    if (!parsedArgs) {
      const primaryPath = chunk.locations?.[0]?.path ?? chunk.title;
      if (primaryPath) {
        parsedArgs = {
          path: primaryPath,
          TargetFile: primaryPath,
          AbsolutePath: primaryPath,
        };
      } else {
        parsedArgs = {};
      }
    }

    events.push({
      type: 'tool_call',
      call: {
        name: parsedName,
        arguments: parsedArgs,
        toolCallId: chunk.toolCallId,
        title: chunk.title,
        status: chunk.status,
      },
      isUpdate: typeKey === 'tool_call_update',
      _meta,
    });
  } else if ((typeKey as string) === 'status') {
    const chunk = update as unknown as { status: string; title?: string };
    if (chunk.status) {
      events.push({ type: 'status', status: chunk.status, title: chunk.title, _meta });
    }
  } else if (typeKey === 'usage_update') {
    const chunk = update as unknown as {
      used: number | string;
      size: number | string;
      cost?: {
        amount: number | string;
        currency: string;
      };
    };
    const used = typeof chunk.used === 'number' ? chunk.used : parseInt(chunk.used, 10);
    const size = typeof chunk.size === 'number' ? chunk.size : parseInt(chunk.size, 10);
    let cost: { amount: number; currency: string } | undefined = undefined;
    if (chunk.cost) {
      const amt =
        typeof chunk.cost.amount === 'number' ? chunk.cost.amount : parseFloat(chunk.cost.amount);
      if (!isNaN(amt)) {
        cost = {
          amount: amt,
          currency: chunk.cost.currency,
        };
      }
    }
    if (!isNaN(used) && !isNaN(size)) {
      events.push({
        type: 'usage_update',
        used,
        size,
        cost,
        _meta,
      });
    }
  } else if (typeKey === 'available_commands_update') {
    const chunk = update as unknown as {
      availableCommands?: {
        name: string;
        description: string;
        input?: {
          hint: string;
        };
      }[];
    };
    if (chunk.availableCommands && Array.isArray(chunk.availableCommands)) {
      events.push({
        type: 'available_commands_update',
        commands: chunk.availableCommands.map((cmd) => ({
          name: cmd.name,
          description: cmd.description,
          input: cmd.input ? { hint: cmd.input.hint } : undefined,
        })),
        _meta,
      });
    }
  } else if ((typeKey as string) === 'plan') {
    const chunk = update as { entries?: { content: string; priority?: string; status: string }[] };
    if (Array.isArray(chunk.entries)) {
      events.push({
        type: 'plan_update',
        plan: chunk.entries.map((entry) => ({
          name: entry.content,
          status: entry.status as 'pending' | 'in_progress' | 'completed',
          isCompleted: entry.status === 'completed',
        })),
        _meta,
      });
    }
  } else if ((typeKey as string) === 'plan_update') {
    const chunk = update as unknown as {
      plan: {
        name: string;
        status: 'pending' | 'in_progress' | 'completed';
        isCompleted: boolean;
      }[];
    };
    if (Array.isArray(chunk.plan)) {
      events.push({
        type: 'plan_update',
        plan: chunk.plan.map((item) => ({
          name: item.name,
          status: item.status,
          isCompleted: item.isCompleted,
        })),
        _meta,
      });
    }
  } else if ((typeKey as string) === 'mode_update') {
    const chunk = update as unknown as { modeId: string };
    if (chunk.modeId) {
      events.push({ type: 'mode_update', modeId: chunk.modeId, _meta });
    }
  } else if ((typeKey as string) === 'session_info_update') {
    const chunk = update as Record<string, unknown>;
    events.push({
      type: 'session_info_update',
      title: typeof chunk.title === 'string' || chunk.title === null ? chunk.title : undefined,
      updatedAt:
        typeof chunk.updatedAt === 'string' || chunk.updatedAt === null
          ? chunk.updatedAt
          : undefined,
      _meta,
    });
  } else if ((typeKey as string) === 'user_message_chunk') {
    const chunk = update as { content?: { type?: string; text?: string } };
    const text = chunk.content?.text;
    if (text) {
      events.push({ type: 'text', text, _meta });
    }
  } else if ((typeKey as string) === 'config_option_update') {
    const chunk = update as { configOptions?: ACPConfigOption[] };
    if (chunk.configOptions && chunk.configOptions.length > 0) {
      events.push({ type: 'config_option_update', configOptions: chunk.configOptions, _meta });
    }
  }

  return events;
}

function getCacheKey(command: string, args: string[], env: Record<string, string>): string {
  const data = JSON.stringify({ command, args, env });
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * The `session/delete` capability is an ACP extension not present in the SDK's
 * generated `SessionCapabilities` type. Read it defensively without widening casts.
 */
export function sessionSupportsDelete(caps: unknown): boolean {
  if (!caps || typeof caps !== 'object') {
    return false;
  }
  return Boolean((caps as { delete?: unknown }).delete);
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
  ): void;
}

export class DefaultAgentRuntime implements AgentRuntime {
  private connectionManager?: IConnectionManager;

  constructor(
    private spawnImpl: typeof spawn = spawn,
    private logger: Logger = noopLogger,
    private createTransport: (child: ChildProcess, logger: Logger) => AgentStreamTransport = (
      child,
      logger,
    ) => new ProcessStreamTransport(child, logger),
    private cache?: CacheStorage,
  ) {}

  setConnectionManager(manager: IConnectionManager): void {
    this.connectionManager = manager;
  }

  private getCache(): CacheStorage {
    if (this.cache) return this.cache;
    const defaultPath = path.join(os.homedir(), '.agentctl', 'capabilities-manifest.json');
    return new FileCacheStorage(defaultPath);
  }

  async execute(
    command: string,
    args: string[],
    options: RuntimeOptions,
    callbacks: SessionCallbacks,
  ): Promise<AgentRuntimeHandle> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    let child!: ChildProcess;
    let transport!: AgentStreamTransport;
    let connection!: ClientSideConnection;
    let isPersistent = false;
    let providerId = '';

    if (this.connectionManager) {
      providerId = this.connectionManager.getProviderIdByCommand(command) ?? command;
      try {
        const persistentConn = await this.connectionManager.getConnection(providerId);
        child = persistentConn.child;
        transport = persistentConn.transport;
        connection = persistentConn.connection;
        isPersistent = true;
      } catch (err) {
        this.logger.warn(
          err,
          `Failed to get persistent connection for ${providerId}, falling back to spawn`,
        );
      }
    }

    const logger = this.logger;
    let terminalManager: TerminalManager | undefined;

    if (!isPersistent) {
      child = this.spawnImpl(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: cleanEnv(options.env),
        cwd: options.cwd,
      });

      transport = this.createTransport(child, this.logger);

      const stream = this.wrapDebug(ndJsonStream(transport.stdin, transport.stdout));

      const activeTerminalManager = (terminalManager = new TerminalManager(logger));

      connection = new ClientSideConnection(() => {
        const handlers: Record<string, unknown> = {
          async sessionUpdate(n: SessionNotification) {
            const events = parseNotificationToEvents(n);
            for (const event of events) {
              await callbacks.onEvent(event);
            }
          },
          async requestPermission(r: RequestPermissionRequest) {
            const toolCall = r.toolCall as unknown as PermissionToolCall;
            const rawInput = toolCall.rawInput as Record<string, unknown> | undefined;

            let parsedName = typeof toolCall.name === 'string' ? toolCall.name : '';
            if (!parsedName && toolCall.toolCallId) {
              parsedName = toolCall.toolCallId.split('__')[0];
            }
            if (!parsedName) {
              parsedName = typeof toolCall.kind === 'string' ? toolCall.kind : 'tool';
            }

            let parsedArgs = toolCall.arguments;
            if (!parsedArgs) {
              if (rawInput && typeof rawInput === 'object') {
                if (rawInput.arguments && typeof rawInput.arguments === 'object') {
                  parsedArgs = rawInput.arguments as Record<string, unknown>;
                } else {
                  const rest = { ...rawInput };
                  delete rest.name;
                  delete rest.arguments;
                  parsedArgs = rest;
                }
              }
            }
            if (!parsedArgs) {
              const locations = toolCall.locations;
              const primaryPath =
                locations?.[0]?.path ??
                (typeof toolCall.title === 'string' ? toolCall.title : undefined);
              if (primaryPath) {
                parsedArgs = {
                  path: primaryPath,
                  TargetFile: primaryPath,
                  AbsolutePath: primaryPath,
                };
              }
            }

            const domainReq: DomainPermissionRequest = {
              permissionId: toolCall.toolCallId ?? '',
              description: typeof toolCall.title === 'string' ? toolCall.title : '',
              options: r.options.map((opt) => ({
                optionId: opt.optionId,
                label: opt.name,
              })),
              toolCall: {
                name: parsedName,
                arguments: parsedArgs,
                toolCallId: toolCall.toolCallId,
              },
            };
            const domainResp = await callbacks.onRequestPermission(domainReq);
            if (domainResp.allowed && domainResp.optionId) {
              return {
                outcome: { outcome: 'selected', optionId: domainResp.optionId },
              };
            }
            return { outcome: { outcome: 'cancelled' } };
          },
          async 'fs.readTextFile'(p: { path: string }) {
            const absPath = path.isAbsolute(p.path) ? p.path : path.resolve(options.cwd, p.path);
            if (!fs.existsSync(absPath)) {
              throw new Error(`File not found: ${absPath}`);
            }
            const content = fs.readFileSync(absPath, 'utf8');
            return Promise.resolve({ content });
          },
          async 'fs.writeTextFile'(p: { path: string; content: string }) {
            const absPath = path.isAbsolute(p.path) ? p.path : path.resolve(options.cwd, p.path);
            const dir = path.dirname(absPath);
            if (!fs.existsSync(dir)) {
              fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(absPath, p.content, 'utf8');
            return Promise.resolve({});
          },
          async 'terminal/create'(p: {
            command: string;
            args?: string[];
            cwd?: string;
            env?: Record<string, string>;
          }) {
            const terminalCwd = p.cwd
              ? path.isAbsolute(p.cwd)
                ? p.cwd
                : path.resolve(options.cwd, p.cwd)
              : options.cwd;
            logger.debug(`Terminal create requested for ${p.command} in ${terminalCwd}`);
            const terminalId = activeTerminalManager.spawn({
              command: p.command,
              args: p.args,
              cwd: terminalCwd,
              env: p.env,
            });
            await callbacks.onEvent({ type: 'terminal_created', terminalId, command: p.command });
            return Promise.resolve({ terminalId });
          },
          async 'terminal/release'(p: { terminalId: string }) {
            logger.debug(`Terminal release requested for ${p.terminalId}`);
            activeTerminalManager.release(p.terminalId);
            return Promise.resolve({});
          },
          async 'terminal/output'(p: { terminalId: string }) {
            logger.debug(`Terminal output requested for ${p.terminalId}`);
            const term = activeTerminalManager.getTerminal(p.terminalId);
            if (!term) {
              return Promise.reject(new Error(`Terminal not found: ${p.terminalId}`));
            }
            const exitStatus = term.hasExited
              ? { exitCode: term.exitCode, signal: term.signal }
              : undefined;
            return Promise.resolve({
              output: term.output,
              truncated: false,
              ...(exitStatus ? { exitStatus } : {}),
            });
          },
          async 'terminal/wait_for_exit'(p: { terminalId: string }) {
            logger.debug(`Terminal wait_for_exit requested for ${p.terminalId}`);
            const term = activeTerminalManager.getTerminal(p.terminalId);
            if (!term) {
              return Promise.reject(new Error(`Terminal not found: ${p.terminalId}`));
            }
            const res = await term.closed;
            return Promise.resolve({
              exitCode: res.exitCode,
              signal: res.signal,
            });
          },
          async 'terminal/kill'(p: { terminalId: string }) {
            logger.debug(`Terminal kill requested for ${p.terminalId}`);
            activeTerminalManager.kill(p.terminalId);
            return Promise.resolve({});
          },
          async 'terminal/write'(p: { terminalId: string; data: string }) {
            logger.debug(`Terminal write requested for ${p.terminalId}`);
            const ok = activeTerminalManager.write(p.terminalId, p.data);
            if (!ok) {
              return Promise.reject(new Error(`Failed to write to terminal ${p.terminalId}`));
            }
            return Promise.resolve({});
          },
          async 'builtin/bash'(p: {
            command: string;
            args?: string[];
            pty?: boolean;
            input?: string;
            cwd?: string;
          }) {
            const resolvedCwd = p.cwd
              ? path.isAbsolute(p.cwd)
                ? p.cwd
                : path.resolve(options.cwd, p.cwd)
              : options.cwd;
            logger.debug(`builtin/bash: ${p.command} in ${resolvedCwd} (pty: ${String(p.pty)})`);
            const terminalId = activeTerminalManager.spawn({
              command: p.command,
              args: p.args,
              cwd: resolvedCwd,
            });
            if (p.input) {
              activeTerminalManager.write(terminalId, p.input);
            }
            if (!p.pty) {
              const result = await activeTerminalManager.wait(terminalId);
              const term = activeTerminalManager.getTerminal(terminalId);
              return {
                output: term?.output ?? '',
                exitCode: result?.exitCode,
              };
            }
            // pty mode: return terminalId immediately, output streams via events, input via HTTP
            return {
              terminalId,
              output: '',
              exitCode: null,
            };
          },
        };

        return new Proxy(handlers, {
          get(target, prop, receiver) {
            if (
              typeof prop === 'string' &&
              (prop.startsWith('_') ||
                prop.includes('.') ||
                prop.includes('/') ||
                prop.includes('__'))
            ) {
              const canonical = typeof prop === 'string' ? prop.replace(/\./g, '/') : prop;
              if (canonical in target) {
                return Reflect.get(target, canonical, receiver);
              }
              if (!(prop in target)) {
                if (prop.includes('__') && options.mcpGateway) {
                  const parts = prop.split('__');
                  const serverId = parts[0];
                  const toolName = parts.slice(1).join('__');
                  const mcpGateway = options.mcpGateway;
                  return async (params: unknown) => {
                    try {
                      logger.info(
                        { serverId, toolName, params },
                        `Routing tool call to client-side MCP gateway`,
                      );
                      const args =
                        typeof params === 'object' && params !== null
                          ? (params as Record<string, unknown>)
                          : {};
                      const result = await mcpGateway.callTool(serverId, toolName, args);
                      return result;
                    } catch (err: unknown) {
                      logger.error(err, `Failed to execute client-side MCP tool: ${prop}`);
                      throw err;
                    }
                  };
                }
                return (params: unknown) => {
                  logger.debug({ params }, `Generic handler for ${prop}`);
                  return Promise.resolve({});
                };
              }
            }
            return Reflect.get(target, prop, receiver) as unknown;
          },
        }) as unknown as Client;
      }, stream);
    }

    if (!isPersistent && terminalManager) {
      terminalManager.on('output', (event) => {
        const { terminalId, data } = event as { terminalId: string; data: string };
        const conn = connection as unknown as { notification: (p: unknown) => void };
        conn.notification({
          method: 'terminal/output',
          params: { terminalId, data },
        });
        void callbacks.onEvent({ type: 'terminal_output', terminalId, data });
      });

      terminalManager.on('exit', (event) => {
        const { terminalId, code } = event as { terminalId: string; code: number | null };
        const conn = connection as unknown as { notification: (p: unknown) => void };
        conn.notification({
          method: 'terminal/exit',
          params: { terminalId, code },
        });
        void callbacks.onEvent({ type: 'terminal_exit', terminalId, code });
      });
    }

    let supportsResumeSession = false;
    let supportsCloseSession = false;
    let supportsDeleteSession = false;
    let supportsListSessions = false;
    let supportsAdditionalDirectories = false;
    let supportsLoadSession = false;

    const handle: AgentRuntimeHandle = {
      acpSessionId: null,
      closed: Promise.race([connection.closed, transport.closed]),
      onProcessError(handler) {
        child.on('error', handler);
      },
      onProcessExit(handler) {
        child.once('exit', handler);
      },
      async prompt(
        text: string,
        attachments?: { filePath: string; mimeType: string }[],
        embeddedContext?: string,
      ): Promise<PromptResult> {
        const promptParts: ContentBlock[] = [];
        if (text) {
          promptParts.push({ type: 'text', text });
        }
        if (embeddedContext) {
          promptParts.push({
            type: 'resource',
            resource: {
              uri: 'internal://embedded_context',
              text: embeddedContext,
              mimeType: 'text/markdown',
            },
          } as unknown as ContentBlock);
        }
        for (const att of attachments ?? []) {
          const data = fs.readFileSync(att.filePath).toString('base64');
          if (att.mimeType.startsWith('audio/')) {
            promptParts.push({
              type: 'audio',
              data,
              mimeType: att.mimeType,
            });
          } else {
            promptParts.push({
              type: 'image',
              data,
              mimeType: att.mimeType,
            });
          }
        }
        const messageId = crypto.randomUUID();
        const response = await connection.prompt({
          sessionId: this.acpSessionId ?? '',
          prompt: promptParts,
          messageId,
        });
        return {
          stopReason: response.stopReason,
          usage: response.usage ?? undefined,
          userMessageId: response.userMessageId ?? undefined,
        };
      },
      async authenticate(methodId: string): Promise<void> {
        await (connection.authenticate({ methodId }) as Promise<unknown>);
      },
      async cancel(): Promise<void> {
        if (this.acpSessionId) {
          await (connection.cancel({ sessionId: this.acpSessionId }) as Promise<unknown>);
        }
      },
      async stop(): Promise<void> {
        if (this.acpSessionId) {
          if (isPersistent && self.connectionManager) {
            await self.connectionManager.closeSession(providerId, this.acpSessionId);
          } else if (supportsCloseSession) {
            try {
              await withTimeout(
                connection.closeSession({ sessionId: this.acpSessionId }),
                2000,
                'closing ACP session',
              );
            } catch {
              // Ignore error on close, we still want to kill the process
            }
          }
        }
        if (!isPersistent) {
          transport.kill();
          if (terminalManager) {
            await terminalManager.dispose();
          }
        }
      },
      async updateModel(modelId: string): Promise<void> {
        if (this.acpSessionId) {
          await connection.unstable_setSessionModel({
            sessionId: this.acpSessionId,
            modelId,
          });
        }
      },
      async updateConfigOption(configId: string, value: string): Promise<ACPConfigOption[]> {
        if (!this.acpSessionId) return [];
        const result = await connection.setSessionConfigOption({
          sessionId: this.acpSessionId,
          configId,
          value,
        });
        return result.configOptions as ACPConfigOption[];
      },
      async setMode(modeId: string): Promise<void> {
        if (this.acpSessionId) {
          await connection.setSessionMode({
            sessionId: this.acpSessionId,
            modeId,
          });
        }
      },
      async deleteSession(acpSessionId: string): Promise<void> {
        if (supportsDeleteSession) {
          await withTimeout(
            connection.extMethod('session/delete', { sessionId: acpSessionId }),
            5000,
            'deleting ACP session',
          );
        }
      },
      async listSessions(params?: {
        cwd?: string;
        cursor?: string;
      }): Promise<{ sessions: unknown[]; nextCursor?: string }> {
        if (!supportsListSessions) return { sessions: [] };
        const result = await withTimeout(
          connection.listSessions(params ?? {}),
          5000,
          'listing ACP sessions',
        );
        return { sessions: result.sessions, nextCursor: result.nextCursor ?? undefined };
      },
      async logout(): Promise<void> {
        await connection.unstable_logout({});
      },
      writeTerminalInput(terminalId: string, data: string): boolean {
        if (isPersistent && self.connectionManager) {
          return self.connectionManager.writeTerminalInput(terminalId, data);
        }
        return terminalManager ? terminalManager.write(terminalId, data) : false;
      },
    };

    try {
      if (isPersistent && self.connectionManager) {
        const persistentConn = await self.connectionManager.getConnection(providerId);
        supportsResumeSession = !!persistentConn.supportsResumeSession;
        supportsCloseSession = !!persistentConn.supportsCloseSession;
        supportsDeleteSession = !!persistentConn.supportsDeleteSession;
        supportsListSessions = !!persistentConn.supportsListSessions;
        supportsAdditionalDirectories = !!persistentConn.supportsAdditionalDirectories;
        supportsLoadSession = !!persistentConn.supportsResumeSession;
      } else {
        const initResult = await withTimeout(
          Promise.race([
            connection.initialize({
              protocolVersion: 1,
              clientCapabilities: {
                terminal: true,
                fs: {
                  readTextFile: true,
                  writeTextFile: true,
                },
                _meta: {
                  builtin: { bash: true },
                },
              },
              clientInfo: { name: 'agentctl', title: 'Agentctl', version: '1.0.0' },
            }),
            transport.closed.then(() => {
              throw new Error('ACP agent process exited before initialization completed');
            }),
          ]),
          60_000,
          'initializing ACP connection',
        );

        const agentCapabilities = initResult.agentCapabilities;
        const sessionCaps = agentCapabilities?.sessionCapabilities;
        supportsResumeSession = !!sessionCaps?.resume;
        supportsCloseSession = !!sessionCaps?.close;
        supportsDeleteSession = sessionSupportsDelete(sessionCaps);
        supportsListSessions = !!sessionCaps?.list;
        supportsAdditionalDirectories = !!sessionCaps?.additionalDirectories;
        supportsLoadSession = !!agentCapabilities?.loadSession;
      }
      let newSessionResult:
        NewSessionResponse | ResumeSessionResponse | LoadSessionResponse | null = null;
      let acpSessionId: string | null = null;

      const baseSessionParams = {
        cwd: options.cwd,
        mcpServers: options.mcpServers ?? [],
        ...(supportsAdditionalDirectories && options.additionalDirectories
          ? { additionalDirectories: options.additionalDirectories }
          : {}),
      };

      try {
        if (options.existingAgentSessionId && (supportsResumeSession || supportsLoadSession)) {
          try {
            if (supportsResumeSession) {
              newSessionResult = await withTimeout(
                connection.resumeSession({
                  sessionId: options.existingAgentSessionId,
                  ...baseSessionParams,
                }),
                60_000,
                'resuming ACP session',
              );
            } else {
              newSessionResult = await withTimeout(
                connection.loadSession({
                  sessionId: options.existingAgentSessionId,
                  ...baseSessionParams,
                }),
                60_000,
                'loading ACP session',
              );
            }
            acpSessionId = options.existingAgentSessionId;
          } catch (loadErr) {
            this.logger.warn(
              loadErr,
              `Failed to load/resume existing session ${options.existingAgentSessionId}, falling back to new session`,
            );
            const created = await withTimeout(
              connection.newSession(baseSessionParams),
              60_000,
              'creating ACP session',
            );
            newSessionResult = created;
            acpSessionId = created.sessionId;
          }
        } else {
          const created = await withTimeout(
            connection.newSession(baseSessionParams),
            60_000,
            'creating ACP session',
          );
          newSessionResult = created;
          acpSessionId = created.sessionId;
        }
      } catch (err: unknown) {
        const error = err as { code?: string; data?: { configOptions?: ACPConfigOption[] } };
        if (error.code === 'auth_required') {
          throw new AuthRequiredError(
            'Authentication required',
            connection,
            child,
            error.data?.configOptions ?? [],
          );
        }
        throw err;
      }

      handle.acpSessionId = acpSessionId;

      if (!handle.availableModes || handle.availableModes.length === 0) {
        const resultModes = newSessionResult.modes?.availableModes ?? [];
        if (resultModes.length > 0) {
          handle.availableModes = resultModes.map((m) => m.id);
        } else if (newSessionResult.configOptions) {
          // If modes are exposed in config options
          const modeOpt = newSessionResult.configOptions.find(
            (opt): opt is Extract<SessionConfigOption, { type: 'select' }> =>
              opt.id === 'mode' && opt.type === 'select',
          );
          if (modeOpt?.options) {
            handle.availableModes = modeOpt.options
              .filter((opt) => typeof (opt as { value?: unknown }).value === 'string')
              .map((opt) => (opt as { value: string }).value);
          }
        }
      }

      const finalSessionId = handle.acpSessionId;
      if (finalSessionId) {
        if (
          options.supportsDynamicModel &&
          options.selectedModel &&
          options.selectedModel !== 'default'
        ) {
          await connection.unstable_setSessionModel({
            sessionId: finalSessionId,
            modelId: options.selectedModel,
          });
        } else if (
          options.selectedModel &&
          options.selectedModel !== 'default' &&
          options.resolvedModelConfigId
        ) {
          try {
            await connection.setSessionConfigOption({
              sessionId: finalSessionId,
              configId: options.resolvedModelConfigId,
              value: options.selectedModel,
            });
          } catch (configErr) {
            this.logger.warn(
              configErr,
              `Failed to dynamically set model configuration on init (configId: ${options.resolvedModelConfigId})`,
            );
          }
        }

        if (
          options.supportsDynamicConfig &&
          options.selectedThinkingEffort &&
          options.resolvedThinkingConfigId
        ) {
          try {
            await connection.setSessionConfigOption({
              sessionId: finalSessionId,
              configId: options.resolvedThinkingConfigId,
              value: options.selectedThinkingEffort,
            });
          } catch (configErr) {
            this.logger.warn(
              configErr,
              `Failed to dynamically set thinking effort on init (configId: ${options.resolvedThinkingConfigId})`,
            );
          }
        }
      }

      if (isPersistent && finalSessionId && self.connectionManager) {
        self.connectionManager.registerActiveSession(finalSessionId, {
          acpSessionId: finalSessionId,
          localSessionId: options.existingAgentSessionId ?? '',
          options,
          callbacks,
        });
      }

      return handle;
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        throw err;
      }
      await handle.stop();
      throw err;
    }
  }

  async probe(
    command: string,
    args: string[],
    env?: Record<string, string>,
  ): Promise<AgentProbeResult> {
    const cleanEnvObj = cleanEnv(env);
    const cacheKey = getCacheKey(command, args, cleanEnvObj);
    const cache = this.getCache();

    try {
      const cached = await cache.get(cacheKey);
      if (cached) {
        this.logger.debug(`Capabilities manifest cache hit for provider ${command}`);
        return cached;
      }
    } catch (cacheErr) {
      this.logger.warn(cacheErr, 'Failed to read from capabilities manifest cache');
    }

    const child = this.spawnImpl(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: cleanEnvObj,
      cwd: os.tmpdir(),
    });

    const transport = this.createTransport(child, this.logger);
    // Suppress unhandled errors from process exit during probe
    transport.closed.catch(() => undefined);

    const stream = this.wrapDebug(ndJsonStream(transport.stdin, transport.stdout));

    const connection = new ClientSideConnection(
      () => ({
        sessionUpdate() {
          return Promise.resolve();
        },
        requestPermission() {
          return Promise.resolve<RequestPermissionResponse>({
            outcome: { outcome: 'selected', optionId: 'allow-once' },
          });
        },
      }),
      stream,
    );

    try {
      const result = await Promise.race([
        (async (): Promise<AgentProbeResult> => {
          const initResult = await connection.initialize({
            protocolVersion: 1,
            clientInfo: { name: 'agentctl-probe', version: '1.0.0' },
          });

          const agentCapabilities = initResult.agentCapabilities;

          let status: 'ready' | 'needs_auth' = 'ready';
          let configOptions: ACPConfigOption[] = [];
          let supportsDynamicModel = false;
          let supportsDynamicConfig = false;

          try {
            const sessionResult = await connection.newSession({
              cwd: os.tmpdir(),
              mcpServers: [],
            });

            if (sessionResult.configOptions) {
              configOptions = sessionResult.configOptions as ACPConfigOption[];
            } else {
              const models = sessionResult.models;
              if (models?.availableModels) {
                configOptions.push({
                  id: 'model',
                  name: 'Model',
                  description: 'Select the model to use',
                  type: 'select',
                  currentValue: models.currentModelId,
                  options: models.availableModels.map((m) => ({
                    value: m.modelId,
                    name: m.name,
                    description: m.description ?? undefined,
                  })),
                });
              }
              const modes = sessionResult.modes;
              if (modes?.availableModes) {
                configOptions.push({
                  id: 'mode',
                  name: 'Mode',
                  description: 'Select the tool approval mode',
                  type: 'select',
                  currentValue: modes.currentModeId,
                  options: modes.availableModes.map((m) => ({
                    value: m.id,
                    name: m.name,
                    description: m.description ?? undefined,
                  })),
                });
              }
            }

            const hasAlternateModels = (sessionResult.models?.availableModels ?? []).length > 0;
            supportsDynamicModel = hasAlternateModels;

            // Inspect if configOptions / settings schema exists and has parameters defined
            supportsDynamicConfig = configOptions.length > 0;

            const modes = sessionResult.modes?.availableModes.map((m) => m.id);
            const supportsLogout = !!agentCapabilities?.auth?.logout;

            const probeResult: AgentProbeResult = {
              status,
              configOptions,
              authMethods: (initResult.authMethods ?? []) as AuthMethod[],
              supportsDynamicModel,
              supportsDynamicConfig,
              modes,
              supportsLogout,
            };

            try {
              await cache.set(cacheKey, probeResult);
            } catch (cacheErr) {
              this.logger.warn(cacheErr, 'Failed to write to capabilities manifest cache');
            }

            return probeResult;
          } catch (err: unknown) {
            const error = err as { code?: string; data?: { configOptions?: ACPConfigOption[] } };
            if (error.code === 'auth_required') {
              status = 'needs_auth';
              if (error.data?.configOptions) {
                configOptions = error.data.configOptions;
              }
            } else {
              throw err;
            }
          }

          const supportsLogout = !!agentCapabilities?.auth?.logout;

          const probeResult: AgentProbeResult = {
            status,
            configOptions,
            authMethods: (initResult.authMethods ?? []) as AuthMethod[],
            supportsDynamicModel,
            supportsDynamicConfig,
            supportsLogout,
          };

          return probeResult;
        })(),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error('Probe timed out'));
          }, 60_000);
        }),
      ]);

      return result;
    } finally {
      transport.kill();
    }
  }

  async deleteAgentSession(
    command: string,
    args: string[],
    env: Record<string, string> | undefined,
    acpSessionId: string,
  ): Promise<void> {
    const cleanEnvObj = cleanEnv(env);
    const child = this.spawnImpl(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: cleanEnvObj,
      cwd: os.tmpdir(),
    });

    const transport = this.createTransport(child, this.logger);
    const stream = this.wrapDebug(ndJsonStream(transport.stdin, transport.stdout));

    const connectionInstance = new ClientSideConnection(
      () => ({
        sessionUpdate() {
          return Promise.resolve();
        },
        requestPermission() {
          return Promise.resolve<RequestPermissionResponse>({
            outcome: { outcome: 'selected', optionId: 'allow-once' },
          });
        },
      }),
      stream,
    );

    // Suppress unhandled transport errors during delete call
    transport.closed.catch(() => undefined);

    try {
      const initResult = await withTimeout(
        connectionInstance.initialize({
          protocolVersion: 1,
          clientInfo: { name: 'agentctl-delete', version: '1.0.0' },
        }),
        10_000,
        'initializing connection for delete',
      );

      const supportsDelete = sessionSupportsDelete(
        initResult.agentCapabilities?.sessionCapabilities,
      );
      if (supportsDelete) {
        await withTimeout(
          connectionInstance.extMethod('session/delete', { sessionId: acpSessionId }),
          10_000,
          'sending session/delete request',
        );
      }
    } finally {
      transport.kill();
      await transport.closed.catch(() => undefined);
    }
  }

  private wrapDebug(stream: Stream): Stream {
    if (process.env.AGENTCTL_ACP_DEBUG !== '1') {
      return stream;
    }

    const { readable, writable } = stream;
    const log = (direction: 'send' | 'recv', message: unknown): void => {
      const parsed = message as { method?: string; id?: unknown };
      this.logger.debug({ direction, method: parsed.method, id: parsed.id }, 'ACP message');
    };

    const reader = readable.getReader();
    const loggedReadable = new ReadableStream<AnyMessage>({
      async pull(controller) {
        const { value, done } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        log('recv', value);
        controller.enqueue(value);
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    });

    const writer = writable.getWriter();
    const loggedWritable = new WritableStream<AnyMessage>({
      async write(chunk) {
        log('send', chunk);
        await writer.write(chunk);
      },
      close() {
        return writer.close();
      },
      abort(reason) {
        return writer.abort(reason);
      },
    });

    return { readable: loggedReadable, writable: loggedWritable };
  }
}

export function resolveAllowedPath(
  requestedPath: string,
  cwd: string,
  additionalDirectories: string[] = [],
  _allowWrite = false,
): string {
  const resolved = path.isAbsolute(requestedPath)
    ? requestedPath
    : path.resolve(cwd, requestedPath);

  const canonical = fs.existsSync(resolved) ? fs.realpathSync(resolved) : path.normalize(resolved);
  const roots = [fs.realpathSync(cwd), ...additionalDirectories.map((d) => fs.realpathSync(d))];

  const isWithin = roots.some((root) => {
    const rel = path.relative(root, canonical);
    return !rel.startsWith('..') && !path.isAbsolute(rel);
  });

  if (!isWithin) {
    throw new Error(
      `Directory traversal detected: path "${requestedPath}" is outside allowed roots.`,
    );
  }

  return canonical;
}

export class AcpDebugLog {
  private logs: { timestamp: Date; type: 'incoming' | 'outgoing' | 'stderr'; line: string }[] = [];

  recordLine(type: 'incoming' | 'outgoing' | 'stderr', line: string): void {
    this.logs.push({ timestamp: new Date(), type, line });
  }

  getLogs() {
    return this.logs;
  }
}

export function sessionSupportsClose(caps: unknown): boolean {
  if (!caps || typeof caps !== 'object') return false;
  return Boolean((caps as { close?: unknown }).close);
}

export function sessionSupportsResume(caps: unknown): boolean {
  if (!caps || typeof caps !== 'object') return false;
  return Boolean((caps as { resume?: unknown }).resume);
}
