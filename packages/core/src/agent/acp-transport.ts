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
} from '@agentclientprotocol/sdk';
import type {
  RequestPermissionResponse,
  SessionNotification,
  ContentBlock,
} from '@agentclientprotocol/sdk';
import { type Logger, noopLogger } from '../logger.js';
import type { AuthMethod, ThinkingEffort, ACPConfigOption, SessionMetrics } from '@agentctl/shared';
import { TerminalManager } from './terminal-manager.js';
import type { McpGateway } from './mcp-gateway.js';

export interface ACPConnectionHandle {
  child: ChildProcess;
  connection: Pick<ClientSideConnection, 'initialize' | 'newSession' | 'authenticate' | 'closed'>;
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
  respondToPermission(permissionId: string, response: DomainPermissionResponse): void;
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
      cost = {
        amount:
          typeof chunk.cost.amount === 'number' ? chunk.cost.amount : parseFloat(chunk.cost.amount),
        currency: chunk.cost.currency,
      };
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

export class DefaultAgentRuntime implements AgentRuntime {
  constructor(
    private spawnImpl: typeof spawn = spawn,
    private logger: Logger = noopLogger,
    private createTransport: (child: ChildProcess, logger: Logger) => AgentStreamTransport = (
      child,
      logger,
    ) => new ProcessStreamTransport(child, logger),
    private cache?: CacheStorage,
  ) {}

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
    const child = this.spawnImpl(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: cleanEnv(options.env),
      cwd: options.cwd,
    });

    const transport = this.createTransport(child, this.logger);

    const stream = ndJsonStream(transport.stdin, transport.stdout);

    const logger = this.logger;
    const terminalManager = new TerminalManager(logger);

    const connection = new ClientSideConnection(() => {
      const handlers: Record<string, unknown> = {
        async sessionUpdate(n: SessionNotification) {
          const events = parseNotificationToEvents(n);
          for (const event of events) {
            await callbacks.onEvent(event);
          }
        },
        async requestPermission(r: {
          toolCall: {
            name?: string;
            toolCallId: string;
            kind?: string;
            title?: string;
            locations?: { path?: string }[];
            arguments?: Record<string, unknown>;
            rawInput?: unknown;
          };
          options: { optionId: string; name?: string }[];
        }) {
          const toolCallRaw = r.toolCall as unknown as Record<string, unknown>;
          const rawInput = toolCallRaw.rawInput as Record<string, unknown> | undefined;

          let parsedName = typeof toolCallRaw.name === 'string' ? toolCallRaw.name : '';
          if (!parsedName && r.toolCall.toolCallId) {
            parsedName = r.toolCall.toolCallId.split('__')[0];
          }
          if (!parsedName) {
            parsedName = typeof toolCallRaw.kind === 'string' ? toolCallRaw.kind : 'tool';
          }

          let parsedArgs = toolCallRaw.arguments as Record<string, unknown> | undefined;
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
            const locations = toolCallRaw.locations as { path?: string }[] | undefined;
            const primaryPath =
              locations?.[0]?.path ??
              (typeof toolCallRaw.title === 'string' ? toolCallRaw.title : undefined);
            if (primaryPath) {
              parsedArgs = {
                path: primaryPath,
                TargetFile: primaryPath,
                AbsolutePath: primaryPath,
              };
            }
          }

          const domainReq: DomainPermissionRequest = {
            permissionId: r.toolCall.toolCallId,
            description: typeof toolCallRaw.title === 'string' ? toolCallRaw.title : '',
            options: r.options.map((opt) => ({
              optionId: opt.optionId,
              label: opt.name,
            })),
            toolCall: {
              name: parsedName,
              arguments: parsedArgs,
              toolCallId: r.toolCall.toolCallId,
            },
          };
          const domainResp = await callbacks.onRequestPermission(domainReq);
          if (domainResp.allowed) {
            return {
              outcome: { outcome: 'selected', optionId: domainResp.optionId ?? 'allow-once' },
            };
          } else {
            return { outcome: { outcome: 'cancelled' } };
          }
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
          const terminalId = terminalManager.spawn({
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
          terminalManager.release(p.terminalId);
          return Promise.resolve({});
        },
        async 'terminal/output'(p: { terminalId: string }) {
          logger.debug(`Terminal output requested for ${p.terminalId}`);
          const term = terminalManager.getTerminal(p.terminalId);
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
          const term = terminalManager.getTerminal(p.terminalId);
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
          terminalManager.kill(p.terminalId);
          return Promise.resolve({});
        },
        async 'terminal/write'(p: { terminalId: string; data: string }) {
          logger.debug(`Terminal write requested for ${p.terminalId}`);
          const ok = terminalManager.write(p.terminalId, p.data);
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
          const terminalId = terminalManager.spawn({
            command: p.command,
            args: p.args,
            cwd: resolvedCwd,
          });
          if (p.input) {
            terminalManager.write(terminalId, p.input);
          }
          if (!p.pty) {
            const result = await terminalManager.wait(terminalId);
            const term = terminalManager.getTerminal(terminalId);
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

    const pendingApprovals = new Map<string, (response: RequestPermissionResponse) => void>();
    let supportsCloseSession = false;
    let supportsDeleteSession = false;
    let supportsListSessions = false;

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
      respondToPermission(permissionId: string, response: DomainPermissionResponse): void {
        const resolve = pendingApprovals.get(permissionId);
        if (resolve) {
          if (response.allowed) {
            resolve({
              outcome: { outcome: 'selected', optionId: response.optionId ?? 'allow-once' },
            });
          } else {
            resolve({ outcome: { outcome: 'cancelled' } });
          }
          pendingApprovals.delete(permissionId);
        }
      },
      async stop(): Promise<void> {
        pendingApprovals.clear();
        if (supportsCloseSession && this.acpSessionId) {
          const dynConn = connection as unknown as {
            sendRequest?: (method: string, params: Record<string, unknown>) => Promise<unknown>;
          };
          if (typeof dynConn.sendRequest === 'function') {
            try {
              await withTimeout(
                dynConn.sendRequest('session/close', { sessionId: this.acpSessionId }),
                2000,
                'closing ACP session',
              );
            } catch {
              // Ignore error on close, we still want to kill the process
            }
          }
        }
        transport.kill();
        await terminalManager.dispose();
      },
      async updateModel(modelId: string): Promise<void> {
        const dynConn = connection as unknown as {
          unstable_setSessionModel?: (p: {
            sessionId: string;
            modelId: string;
          }) => Promise<unknown>;
        };
        if (typeof dynConn.unstable_setSessionModel === 'function' && this.acpSessionId) {
          await dynConn.unstable_setSessionModel({
            sessionId: this.acpSessionId,
            modelId,
          });
        }
      },
      async updateConfigOption(configId: string, value: string): Promise<ACPConfigOption[]> {
        const dynConn = connection as unknown as {
          setSessionConfigOption?: (p: {
            sessionId: string;
            configId: string;
            value: string;
          }) => Promise<{ configOptions: ACPConfigOption[] }>;
          sendRequest?: (
            method: string,
            params: Record<string, unknown>,
          ) => Promise<{ configOptions: ACPConfigOption[] }>;
        };
        if (this.acpSessionId && typeof dynConn.sendRequest === 'function') {
          const result = await dynConn.sendRequest('session/set_config_option', {
            sessionId: this.acpSessionId,
            configId,
            value,
          });
          return result.configOptions;
        }
        if (typeof dynConn.setSessionConfigOption === 'function' && this.acpSessionId) {
          const result = await dynConn.setSessionConfigOption({
            sessionId: this.acpSessionId,
            configId,
            value,
          });
          return result.configOptions;
        }
        return [];
      },
      async setMode(modeId: string): Promise<void> {
        const dynConn = connection as unknown as {
          unstable_setSessionMode?: (p: { sessionId: string; modeId: string }) => Promise<unknown>;
          sendRequest?: (method: string, params: Record<string, unknown>) => Promise<unknown>;
        };
        if (typeof dynConn.unstable_setSessionMode === 'function' && this.acpSessionId) {
          await dynConn.unstable_setSessionMode({
            sessionId: this.acpSessionId,
            modeId,
          });
        } else if (this.acpSessionId && typeof dynConn.sendRequest === 'function') {
          await dynConn.sendRequest('session/set_mode', {
            sessionId: this.acpSessionId,
            mode: modeId,
          });
        }
      },
      async deleteSession(acpSessionId: string): Promise<void> {
        if (supportsDeleteSession) {
          const dynConn = connection as unknown as {
            sendRequest?: (method: string, params: Record<string, unknown>) => Promise<unknown>;
          };
          if (typeof dynConn.sendRequest === 'function') {
            await withTimeout(
              dynConn.sendRequest('session/delete', { sessionId: acpSessionId }),
              5000,
              'deleting ACP session',
            );
          }
        }
      },
      async listSessions(params?: {
        cwd?: string;
        cursor?: string;
      }): Promise<{ sessions: unknown[]; nextCursor?: string }> {
        if (supportsListSessions) {
          const dynConn = connection as unknown as {
            sendRequest?: (method: string, params: Record<string, unknown>) => Promise<unknown>;
          };
          if (typeof dynConn.sendRequest === 'function') {
            const res = (await withTimeout(
              dynConn.sendRequest('session/list', params ?? {}),
              5000,
              'listing ACP sessions',
            )) as { sessions: unknown[]; nextCursor?: string };
            return res;
          }
        }
        return { sessions: [] };
      },
      async logout(): Promise<void> {
        const conn = connection as {
          logout?: (params: Record<string, unknown>) => Promise<unknown>;
          sendRequest?: (method: string, params: Record<string, unknown>) => Promise<unknown>;
        };
        if (typeof conn.logout === 'function') {
          await conn.logout({});
        } else if (typeof conn.sendRequest === 'function') {
          await conn.sendRequest('logout', {});
        }
      },
      writeTerminalInput(terminalId: string, data: string): boolean {
        return terminalManager.write(terminalId, data);
      },
    };

    try {
      const initResult = (await withTimeout(
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
        60_000,
        'initializing ACP connection',
      )) as {
        capabilities?: {
          loadSession?: boolean;
          modes?: string[];
          [key: string]: unknown;
        };
      };

      /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
      const sessionCaps = (initResult.capabilities as any)?.sessionCapabilities;
      const supportsResumeSession = !!sessionCaps?.resume;
      supportsCloseSession = !!sessionCaps?.close;
      supportsDeleteSession = !!sessionCaps?.delete;
      supportsListSessions = !!sessionCaps?.list;
      const supportsAdditionalDirectories = !!sessionCaps?.additionalDirectories;
      /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */

      const agentModes = initResult.capabilities?.modes ?? [];
      handle.availableModes = agentModes;

      /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
      const supportsLoadSession = !!initResult.capabilities?.loadSession;
      let newSessionResult: any;
      let acpSessionId: string | null = null;

      try {
        if (options.existingAgentSessionId && (supportsResumeSession || supportsLoadSession)) {
          try {
            if (supportsResumeSession) {
              const dynConn = connection as unknown as {
                sendRequest?: (method: string, params: Record<string, unknown>) => Promise<unknown>;
              };
              if (typeof dynConn.sendRequest === 'function') {
                const params: Record<string, unknown> = {
                  sessionId: options.existingAgentSessionId,
                  cwd: options.cwd,
                  mcpServers: options.mcpServers ?? [],
                };
                if (supportsAdditionalDirectories && options.additionalDirectories) {
                  params.additionalDirectories = options.additionalDirectories;
                }
                newSessionResult = (await withTimeout(
                  dynConn.sendRequest('session/resume', params),
                  60_000,
                  'resuming ACP session',
                )) as { sessionId?: string; [key: string]: unknown };
                acpSessionId = options.existingAgentSessionId;
              } else {
                throw new Error(
                  'connection.sendRequest is not a function, fallback to loadSession',
                );
              }
            } else {
              const params: Parameters<ClientSideConnection['loadSession']>[0] & {
                additionalDirectories?: string[];
              } = {
                sessionId: options.existingAgentSessionId,
                cwd: options.cwd,
                mcpServers: options.mcpServers ?? [],
                ...(supportsAdditionalDirectories && options.additionalDirectories
                  ? { additionalDirectories: options.additionalDirectories }
                  : {}),
              };
              newSessionResult = await withTimeout(
                connection.loadSession(params),
                60_000,
                'loading ACP session',
              );
              acpSessionId = options.existingAgentSessionId;
            }
          } catch (loadErr) {
            this.logger.warn(
              loadErr,
              `Failed to load/resume existing session ${options.existingAgentSessionId}, falling back to new session`,
            );
            const params: Parameters<ClientSideConnection['newSession']>[0] & {
              additionalDirectories?: string[];
            } = {
              cwd: options.cwd,
              mcpServers: options.mcpServers ?? [],
              ...(supportsAdditionalDirectories && options.additionalDirectories
                ? { additionalDirectories: options.additionalDirectories }
                : {}),
            };
            newSessionResult = await withTimeout(
              connection.newSession(params),
              60_000,
              'creating ACP session',
            );
            acpSessionId = newSessionResult.sessionId;
          }
        } else {
          const params: Parameters<ClientSideConnection['newSession']>[0] & {
            additionalDirectories?: string[];
          } = {
            cwd: options.cwd,
            mcpServers: options.mcpServers ?? [],
            ...(supportsAdditionalDirectories && options.additionalDirectories
              ? { additionalDirectories: options.additionalDirectories }
              : {}),
          };
          newSessionResult = await withTimeout(
            connection.newSession(params),
            60_000,
            'creating ACP session',
          );
          acpSessionId = newSessionResult.sessionId;
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
      /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */

      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-condition */
      if ((!handle.availableModes || handle.availableModes.length === 0) && newSessionResult) {
        const resultModes = newSessionResult.modes?.availableModes ?? [];
        if (resultModes.length > 0) {
          handle.availableModes = resultModes.map((m: any) => m.id);
        } else if (newSessionResult.configOptions) {
          // If modes are exposed in config options
          const modeOpt = newSessionResult.configOptions.find((opt: any) => opt.id === 'mode');
          if (modeOpt?.options) {
            handle.availableModes = modeOpt.options.map((opt: any) => opt.value);
          }
        }
      }
      /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-condition */

      const dynConn = connection as unknown as {
        unstable_setSessionModel?: (p: { sessionId: string; modelId: string }) => Promise<unknown>;
        setSessionConfigOption?: (p: {
          sessionId: string;
          configId: string;
          value: string;
        }) => Promise<unknown>;
      };

      const finalSessionId = handle.acpSessionId;
      if (finalSessionId) {
        if (
          options.supportsDynamicModel &&
          options.selectedModel &&
          options.selectedModel !== 'default'
        ) {
          if (typeof dynConn.unstable_setSessionModel === 'function') {
            await dynConn.unstable_setSessionModel({
              sessionId: finalSessionId,
              modelId: options.selectedModel,
            });
          }
        } else if (
          options.selectedModel &&
          options.selectedModel !== 'default' &&
          options.resolvedModelConfigId
        ) {
          if (typeof dynConn.setSessionConfigOption === 'function') {
            try {
              await dynConn.setSessionConfigOption({
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
        }

        if (
          options.supportsDynamicConfig &&
          options.selectedThinkingEffort &&
          options.resolvedThinkingConfigId
        ) {
          if (typeof dynConn.setSessionConfigOption === 'function') {
            try {
              await dynConn.setSessionConfigOption({
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

    const stream = ndJsonStream(transport.stdin, transport.stdout);

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

          let status: 'ready' | 'needs_auth' = 'ready';
          let configOptions: ACPConfigOption[] = [];
          let supportsDynamicModel = false;
          let supportsDynamicConfig = false;

          try {
            const sessionResult = (await connection.newSession({
              cwd: os.tmpdir(),
              mcpServers: [],
            })) as {
              sessionId?: string;
              configOptions?: ACPConfigOption[] | null;
              models?: {
                currentModelId?: string;
                availableModels?: { modelId: string; name: string; description?: string }[];
              };
              modes?: {
                currentModeId?: string;
                availableModes?: { id: string; name: string; description?: string }[];
              };
            };

            if (sessionResult.configOptions) {
              configOptions = sessionResult.configOptions;
            } else {
              const models = sessionResult.models;
              if (models?.availableModels) {
                configOptions.push({
                  id: 'model',
                  name: 'Model',
                  description: 'Select the model to use',
                  type: 'select',
                  currentValue: models.currentModelId ?? '',
                  options: models.availableModels.map((m) => ({
                    value: m.modelId,
                    name: m.name,
                    description: m.description,
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
                  currentValue: modes.currentModeId ?? '',
                  options: modes.availableModes.map((m) => ({
                    value: m.id,
                    name: m.name,
                    description: m.description,
                  })),
                });
              }
            }

            const initRaw = initResult as unknown as Record<string, unknown>;
            const hasModelsCapability = !!(
              initRaw.capabilities as Record<string, unknown> | undefined
            )?.models;
            const hasAlternateModels = (sessionResult.models?.availableModels ?? []).length > 0;
            supportsDynamicModel = hasModelsCapability || hasAlternateModels;

            // Inspect if configOptions / settings schema exists and has parameters defined
            const hasConfigOptions = configOptions.length > 0;
            supportsDynamicConfig = hasConfigOptions;

            const capabilities = initRaw.capabilities as Record<string, unknown> | undefined;
            const modes = capabilities?.modes as string[] | undefined;
            const supportsLogout = !!(capabilities?.auth as Record<string, unknown> | undefined)
              ?.logout;

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

          const initRaw = initResult as unknown as Record<string, unknown>;
          const capabilities = initRaw.capabilities as Record<string, unknown> | undefined;
          const supportsLogout = !!(capabilities?.auth as Record<string, unknown> | undefined)
            ?.logout;

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
    /* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-empty-function, @typescript-eslint/no-unsafe-assignment */
    const cleanEnvObj = cleanEnv(env);
    const child = this.spawnImpl(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: cleanEnvObj,
      cwd: os.tmpdir(),
    });

    const transport = this.createTransport(child, this.logger);

    const stream = ndJsonStream(transport.stdin, transport.stdout);

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

    // Suppress unhandled errors during delete call
    (connectionInstance as any).on('error', () => {});
    transport.closed.catch(() => {});

    try {
      const initResult = (await withTimeout(
        connectionInstance.initialize({
          protocolVersion: 1,
          clientInfo: { name: 'agentctl-delete', version: '1.0.0' },
        }),
        10_000,
        'initializing connection for delete',
      )) as any;

      const supportsDelete = !!initResult?.capabilities?.sessionCapabilities?.delete;
      if (supportsDelete) {
        const dynConn = connectionInstance as unknown as {
          sendRequest?: (method: string, params: Record<string, unknown>) => Promise<unknown>;
        };
        if (typeof dynConn.sendRequest === 'function') {
          await withTimeout(
            dynConn.sendRequest('session/delete', { sessionId: acpSessionId }),
            10_000,
            'sending session/delete request',
          );
        }
      }
    } finally {
      transport.kill();
      await transport.closed.catch(() => {});
    }
    /* eslint-enable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-empty-function, @typescript-eslint/no-unsafe-assignment */
  }
}

interface GeminiModelInfo {
  modelId: string;
  name: string;
  description?: string;
}

interface GeminiModeInfo {
  id: string;
  name: string;
  description?: string;
}

interface ExtendedSessionResult {
  sessionId?: string;
  configOptions?: ACPConfigOption[] | null;
  models?: { currentModelId?: string; availableModels?: GeminiModelInfo[] };
  modes?: { currentModeId?: string; availableModes?: GeminiModeInfo[] };
}

export class LegacyConnectionRuntimeAdapter implements AgentRuntime {
  constructor(
    private createConnection: typeof createAgentConnection,
    private logger: Logger,
  ) {}

  execute(): Promise<AgentRuntimeHandle> {
    throw new Error('execute is not supported in legacy connection adapter');
  }

  async probe(
    command: string,
    args: string[],
    env?: Record<string, string>,
  ): Promise<AgentProbeResult> {
    const { child, connection } = this.createConnection(command, args, env ?? {});

    try {
      const initResult = await connection.initialize({
        protocolVersion: 1,
        clientInfo: { name: 'agentctl-probe', version: '1.0.0' },
      });

      let status: 'ready' | 'needs_auth' = 'ready';
      let configOptions: ACPConfigOption[] = [];
      let supportsDynamicModel = false;
      let supportsDynamicConfig = false;

      try {
        const sessionResult = (await connection.newSession({
          cwd: os.tmpdir(),
          mcpServers: [],
        })) as ExtendedSessionResult;

        if (sessionResult.configOptions) {
          configOptions = sessionResult.configOptions;
        } else {
          const models = sessionResult.models;
          if (models?.availableModels) {
            configOptions.push({
              id: 'model',
              name: 'Model',
              description: 'Select the model to use',
              type: 'select',
              currentValue: models.currentModelId ?? '',
              options: models.availableModels.map((m) => ({
                value: m.modelId,
                name: m.name,
                description: m.description,
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
              currentValue: modes.currentModeId ?? '',
              options: modes.availableModes.map((m) => ({
                value: m.id,
                name: m.name,
                description: m.description,
              })),
            });
          }
        }

        const initRaw = initResult as unknown as Record<string, unknown>;
        const hasModelsCapability = !!(initRaw.capabilities as Record<string, unknown> | undefined)
          ?.models;
        const hasAlternateModels = (sessionResult.models?.availableModels ?? []).length > 0;
        supportsDynamicModel = hasModelsCapability || hasAlternateModels;

        // Inspect if configOptions / settings schema exists and has parameters defined
        const hasConfigOptions = configOptions.length > 0;
        supportsDynamicConfig = hasConfigOptions;
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

      const initRaw = initResult as unknown as Record<string, unknown>;
      const capabilities = initRaw.capabilities as Record<string, unknown> | undefined;
      const supportsLogout = !!(capabilities?.auth as Record<string, unknown> | undefined)?.logout;

      return {
        status,
        configOptions,
        authMethods: (initResult.authMethods ?? []) as AuthMethod[],
        supportsDynamicModel,
        supportsDynamicConfig,
        supportsLogout,
      };
    } finally {
      child.kill();
    }
  }
}
