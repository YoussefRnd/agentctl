import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import { Readable, Writable } from 'node:stream';
import { ClientSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import type {
  RequestPermissionResponse,
  RequestPermissionRequest,
  SessionNotification,
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
    logger: Logger,
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

  kill(signal?: NodeJS.Signals | number): void {
    if (!this.child.killed) {
      this.child.kill(signal);
    }
  }
}

export interface AgentRuntimeHandle {
  acpSessionId: string | null;
  connection: ClientSideConnection;
  child: ChildProcess;
  closed: Promise<void>;
  prompt(text: string): Promise<void>;
  respondToPermission(permissionId: string, response: RequestPermissionResponse): void;
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
}

export interface SessionCallbacks {
  onUpdate: (notification: SessionNotification) => Promise<void> | void;
  onRequestPermission: (request: RequestPermissionRequest) => Promise<RequestPermissionResponse>;
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
          await callbacks.onUpdate(n);
        },
        requestPermission: (r) => callbacks.onRequestPermission(r),
      }),
      stream,
    );

    const pendingApprovals = new Map<string, (response: RequestPermissionResponse) => void>();

    const handle: AgentRuntimeHandle = {
      acpSessionId: null,
      connection,
      child,
      closed: Promise.race([connection.closed, transport.closed]),
      async prompt(text: string): Promise<void> {
        await (connection.prompt({
          sessionId: this.acpSessionId ?? '',
          prompt: [{ type: 'text', text }],
        }) as Promise<unknown>);
      },
      respondToPermission(permissionId: string, response: RequestPermissionResponse): void {
        const resolve = pendingApprovals.get(permissionId);
        if (resolve) {
          resolve(response);
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
      await withTimeout(
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
      );

      let newSessionResult;
      try {
        newSessionResult = await withTimeout(
          connection.newSession({
            cwd: options.cwd,
            mcpServers: [],
          }),
          60_000,
          'creating ACP session',
        );
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

      handle.acpSessionId = newSessionResult.sessionId;

      const dynConn = connection as unknown as {
        unstable_setSessionModel?: (p: { sessionId: string; modelId: string }) => Promise<unknown>;
        setSessionConfigOption?: (p: {
          sessionId: string;
          configId: string;
          value: string;
        }) => Promise<unknown>;
      };

      if (options.supportsDynamicModel && options.selectedModel && options.selectedModel !== 'default') {
        if (typeof dynConn.unstable_setSessionModel === 'function') {
          await dynConn.unstable_setSessionModel({
            sessionId: handle.acpSessionId,
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
              sessionId: handle.acpSessionId,
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
