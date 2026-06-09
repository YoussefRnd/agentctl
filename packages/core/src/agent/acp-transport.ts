import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import { Readable, Writable } from 'node:stream';
import { ClientSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import type {
  RequestPermissionResponse,
  SessionNotification,
  ContentBlock,
} from '@agentclientprotocol/sdk';
import { type Logger, noopLogger } from '../logger.js';
import type { AuthMethod, ThinkingEffort, ACPConfigOption } from '@agentctl/shared';

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
          reject(new Error(`Process exited with code ${String(code)}${signal ? ` and signal ${signal}` : ''}`));
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
            this.logger.warn(`Process did not exit on SIGTERM, sending SIGKILL to PID ${String(this.child.pid)}`);
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

export type DomainAgentEvent =
  | { type: 'text'; text: string }
  | { type: 'thought'; text: string }
  | { type: 'tool_call'; call: { name: string; arguments?: Record<string, unknown>; toolCallId?: string }; isUpdate: boolean };

export interface AgentRuntimeHandle {
  acpSessionId: string | null;
  closed: Promise<void>;
  onProcessError(handler: (err: Error) => void): void;
  onProcessExit(handler: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  prompt(text: string, attachments?: { filePath: string; mimeType: string }[]): Promise<void>;
  respondToPermission(permissionId: string, response: DomainPermissionResponse): void;
  stop(): Promise<void>;
  updateModel?(modelId: string): Promise<void>;
  updateConfigOption?(configId: string, value: string): Promise<void>;
}

export interface RuntimeOptions {
  cwd: string;
  env?: Record<string, string>;
  selectedModel?: string;
  selectedThinkingEffort?: ThinkingEffort;
  supportsDynamicModel?: boolean;
  supportsDynamicConfig?: boolean;
  resolvedThinkingConfigId?: string;
  existingAgentSessionId?: string | null;
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
}

export interface AgentRuntime {
  execute(
    command: string,
    args: string[],
    options: RuntimeOptions,
    callbacks: SessionCallbacks,
  ): Promise<AgentRuntimeHandle>;

  probe(
    command: string,
    args: string[],
    env?: Record<string, string>,
  ): Promise<AgentProbeResult>;
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

function parseNotificationToEvents(notification: SessionNotification): DomainAgentEvent[] {
  const update = notification.update;
  const typeKey = update.sessionUpdate;
  const events: DomainAgentEvent[] = [];

  if (typeKey === 'agent_message_chunk') {
    const chunk = update as { content?: { type: string; text?: string } };
    const text = chunk.content?.text;
    if (text !== undefined) {
      const isThought = chunk.content?.type === 'thought' || chunk.content?.type === 'thinking';
      if (isThought) {
        events.push({ type: 'thought', text });
      } else {
        events.push({ type: 'text', text });
      }
    }
  } else if (typeKey === 'agent_thought_chunk') {
    const chunk = update as { content?: { type: string; text?: string; thought?: string } };
    const thought = chunk.content?.text ?? chunk.content?.thought;
    if (thought !== undefined) {
      events.push({ type: 'thought', text: thought });
    }
  } else if (typeKey === 'tool_call' || typeKey === 'tool_call_update') {
    const chunk = update as {
      toolCall?: { name: string; arguments?: Record<string, unknown>; toolCallId?: string };
    };
    if (chunk.toolCall) {
      events.push({
        type: 'tool_call',
        call: chunk.toolCall,
        isUpdate: typeKey === 'tool_call_update',
      });
    }
  }

  return events;
}

export class DefaultAgentRuntime implements AgentRuntime {
  constructor(
    private spawnImpl: typeof spawn = spawn,
    private logger: Logger = noopLogger,
    private createTransport: (child: ChildProcess, logger: Logger) => AgentStreamTransport = (child, logger) =>
      new ProcessStreamTransport(child, logger),
  ) {}

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

    const stream = ndJsonStream(
      transport.stdin,
      transport.stdout,
    );

    const connection = new ClientSideConnection(
      () => ({
        async sessionUpdate(n) {
          const events = parseNotificationToEvents(n);
          for (const event of events) {
            await callbacks.onEvent(event);
          }
        },
        async requestPermission(r) {
          const toolCallRaw = r.toolCall as unknown as Record<string, unknown>;
          const domainReq: DomainPermissionRequest = {
            permissionId: r.toolCall.toolCallId,
            description: typeof toolCallRaw.title === 'string' ? toolCallRaw.title : '',
            options: r.options.map(opt => ({
              optionId: opt.optionId,
              label: opt.name
            })),
            toolCall: {
              name: typeof toolCallRaw.name === 'string' ? toolCallRaw.name : '',
              arguments: toolCallRaw.arguments as Record<string, unknown> | undefined,
              toolCallId: r.toolCall.toolCallId,
            }
          };
          const domainResp = await callbacks.onRequestPermission(domainReq);
          if (domainResp.allowed) {
            return { outcome: { outcome: 'selected', optionId: domainResp.optionId ?? 'allow-once' } };
          } else {
            return { outcome: { outcome: 'cancelled' } };
          }
        },
      }),
      stream,
    );

    const pendingApprovals = new Map<string, (response: RequestPermissionResponse) => void>();

    const handle: AgentRuntimeHandle = {
      acpSessionId: null,
      closed: Promise.race([connection.closed, transport.closed]),
      onProcessError(handler) {
        child.on('error', handler);
      },
      onProcessExit(handler) {
        child.once('exit', handler);
      },
      async prompt(text: string, attachments?: { filePath: string; mimeType: string }[]): Promise<void> {
        const promptParts: ContentBlock[] = [];
        if (text) {
          promptParts.push({ type: 'text', text });
        }
        for (const att of attachments ?? []) {
          const data = fs.readFileSync(att.filePath).toString('base64');
          promptParts.push({
            type: 'image',
            data,
            mimeType: att.mimeType,
          });
        }
        await (connection.prompt({
          sessionId: this.acpSessionId ?? '',
          prompt: promptParts,
        }) as Promise<unknown>);
      },
      respondToPermission(permissionId: string, response: DomainPermissionResponse): void {
        const resolve = pendingApprovals.get(permissionId);
        if (resolve) {
          if (response.allowed) {
            resolve({ outcome: { outcome: 'selected', optionId: response.optionId ?? 'allow-once' } });
          } else {
            resolve({ outcome: { outcome: 'cancelled' } });
          }
          pendingApprovals.delete(permissionId);
        }
      },
      async stop(): Promise<void> {
        pendingApprovals.clear();
        transport.kill();
        await Promise.resolve();
      },
      async updateModel(modelId: string): Promise<void> {
        const dynConn = connection as unknown as {
          unstable_setSessionModel?: (p: { sessionId: string; modelId: string }) => Promise<unknown>;
        };
        if (typeof dynConn.unstable_setSessionModel === 'function' && this.acpSessionId) {
          await dynConn.unstable_setSessionModel({
            sessionId: this.acpSessionId,
            modelId,
          });
        }
      },
      async updateConfigOption(configId: string, value: string): Promise<void> {
        const dynConn = connection as unknown as {
          setSessionConfigOption?: (p: {
            sessionId: string;
            configId: string;
            value: string;
          }) => Promise<unknown>;
        };
        if (typeof dynConn.setSessionConfigOption === 'function' && this.acpSessionId) {
          await dynConn.setSessionConfigOption({
            sessionId: this.acpSessionId,
            configId,
            value,
          });
        }
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
          },
          clientInfo: { name: 'agentctl', version: '1.0.0' },
        }),
        60_000,
        'initializing ACP connection',
      )) as {
        capabilities?: {
          loadSession?: boolean;
          [key: string]: unknown;
        };
      };

      const supportsLoadSession = !!initResult.capabilities?.loadSession;
      let newSessionResult;
      let acpSessionId: string | null = null;

      try {
        if (options.existingAgentSessionId && supportsLoadSession) {
          try {
            newSessionResult = await withTimeout(
              connection.loadSession({
                sessionId: options.existingAgentSessionId,
                cwd: options.cwd,
                mcpServers: [],
              }),
              60_000,
              'loading ACP session',
            );
            acpSessionId = options.existingAgentSessionId;
          } catch (loadErr) {
            this.logger.warn(loadErr, `Failed to load existing session ${options.existingAgentSessionId}, falling back to new session`);
            newSessionResult = await withTimeout(
              connection.newSession({
                cwd: options.cwd,
                mcpServers: [],
              }),
              60_000,
              'creating ACP session',
            );
            acpSessionId = newSessionResult.sessionId;
          }
        } else {
          newSessionResult = await withTimeout(
            connection.newSession({
              cwd: options.cwd,
              mcpServers: [],
            }),
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
        if (options.supportsDynamicModel && options.selectedModel && options.selectedModel !== 'default') {
          if (typeof dynConn.unstable_setSessionModel === 'function') {
            await dynConn.unstable_setSessionModel({
              sessionId: finalSessionId,
              modelId: options.selectedModel,
            });
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
                `Failed to dynamically set thinking effort on init (configId: ${options.resolvedThinkingConfigId})`
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
    const child = this.spawnImpl(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: cleanEnv(env),
      cwd: os.tmpdir(),
    });

    const transport = this.createTransport(child, this.logger);

    const stream = ndJsonStream(
      transport.stdin,
      transport.stdout,
    );

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
              models?: { currentModelId?: string; availableModels?: { modelId: string; name: string; description?: string }[] };
              modes?: { currentModeId?: string; availableModes?: { id: string; name: string; description?: string }[] };
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

            const sessionId = sessionResult.sessionId;
            if (sessionId) {
              const dynConn = connection as unknown as {
                unstable_setSessionModel?: (p: { sessionId: string; modelId: string }) => Promise<unknown>;
                setSessionConfigOption?: (p: {
                  sessionId: string;
                  configId: string;
                  value: string;
                }) => Promise<unknown>;
              };

              if (typeof dynConn.unstable_setSessionModel === 'function') {
                try {
                  await dynConn.unstable_setSessionModel({
                    sessionId,
                    modelId: 'probe-test-model-id',
                  });
                  supportsDynamicModel = true;
                } catch (err: unknown) {
                  const rpcErr = err as { code?: number };
                  if (rpcErr.code !== -32601) {
                    supportsDynamicModel = true;
                  }
                }
              }

              if (typeof dynConn.setSessionConfigOption === 'function') {
                try {
                  await dynConn.setSessionConfigOption({
                    sessionId,
                    configId: 'probe-test-config-id',
                    value: 'probe-test-value',
                  });
                  supportsDynamicConfig = true;
                } catch (err: unknown) {
                  const rpcErr = err as { code?: number };
                  if (rpcErr.code !== -32601) {
                    supportsDynamicConfig = true;
                  }
                }
              }
            }
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

          return {
            status,
            configOptions,
            authMethods: initResult.authMethods ?? [],
            supportsDynamicModel,
            supportsDynamicConfig,
          };
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

interface DynamicCapableConnection {
  unstable_setSessionModel?: (params: { sessionId: string; modelId: string }) => Promise<unknown>;
  setSessionConfigOption?: (params: {
    sessionId: string;
    configId: string;
    value: string;
  }) => Promise<unknown>;
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
    const dynConnection = connection as typeof connection & DynamicCapableConnection;

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

        const sessionId = sessionResult.sessionId;
        if (sessionId) {
          if (typeof dynConnection.unstable_setSessionModel === 'function') {
            try {
              await dynConnection.unstable_setSessionModel({
                sessionId,
                modelId: 'probe-test-model-id',
              });
              supportsDynamicModel = true;
            } catch (err: unknown) {
              const rpcErr = err as { code?: number };
              if (rpcErr.code !== -32601) {
                supportsDynamicModel = true;
              }
            }
          }

          if (typeof dynConnection.setSessionConfigOption === 'function') {
            try {
              await dynConnection.setSessionConfigOption({
                sessionId,
                configId: 'probe-test-config-id',
                value: 'probe-test-value',
              });
              supportsDynamicConfig = true;
            } catch (err: unknown) {
              const rpcErr = err as { code?: number };
              if (rpcErr.code !== -32601) {
                supportsDynamicConfig = true;
              }
            }
          }
        }
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

      return {
        status,
        configOptions,
        authMethods: initResult.authMethods ?? [],
        supportsDynamicModel,
        supportsDynamicConfig,
      };
    } finally {
      child.kill();
    }
  }
}
