import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  ClientSideConnection,
  ndJsonStream,
  type RequestPermissionRequest,
  type SessionNotification,
  type NewSessionResponse,
  type ResumeSessionResponse,
  type LoadSessionResponse,
  type SessionConfigOption,
  type Stream,
  type AnyMessage,
  type Client,
} from '@agentclientprotocol/sdk';
import { type Logger, noopLogger } from '../logger.js';
import type { ACPConfigOption, ElicitationRequest } from '@agentctl/shared';
import type {
  AgentRuntime,
  AgentRuntimeHandle,
  AgentStreamTransport,
  RuntimeOptions,
  SessionCallbacks,
  AgentProbeResult,
  IConnectionManager,
  CacheStorage,
  PromptResult,
} from './types.js';
import { AuthRequiredError } from './types.js';
import { ProcessStreamTransport, cleanEnv } from './transport/process-transport.js';
import {
  FileCacheStorage,
  getCacheKey,
  initializeAcpConnection,
  withTimeout,
} from './transport/capabilities-cache.js';
import { parseNotificationToEvents } from './protocol/events.js';
import { handleFsReadTextFile, handleFsWriteTextFile } from './protocol/file-system.js';
import {
  handleTerminalCreate,
  handleTerminalRelease,
  handleTerminalOutput,
  handleTerminalWaitForExit,
  handleTerminalKill,
  handleTerminalWrite,
  handleBuiltinBash,
} from './protocol/terminals.js';
import { parsePermissionRequest, formatPermissionOutcome } from './protocol/permissions.js';
import { buildPromptBlocks } from './protocol/prompt.js';
import { buildBaseSessionParams } from './protocol/session-params.js';
import { TerminalManager } from './protocol/terminal-manager.js';

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
            const domainReq = parsePermissionRequest(r);
            const domainResp = await callbacks.onRequestPermission(domainReq);
            return formatPermissionOutcome(domainResp);
          },
          async createElicitation(p: Record<string, unknown>) {
            const modeObj = p.mode as { type?: string } | undefined;
            const req = {
              id: typeof p.id === 'string' ? p.id : `el-${String(Date.now())}`,
              mode: modeObj?.type === 'url' || typeof p.url === 'string' ? 'url' : 'form',
              form: p.form as ElicitationRequest['form'],
              url: p.url as ElicitationRequest['url'],
            } as ElicitationRequest;
            if (callbacks.onRequestElicitation) {
              return await callbacks.onRequestElicitation(req);
            }
            return { action: 'cancel' };
          },
          async 'fs.readTextFile'(p: { path: string; line?: number; limit?: number }) {
            return Promise.resolve(
              handleFsReadTextFile(p, options.cwd, options.additionalDirectories),
            );
          },
          async 'fs.writeTextFile'(p: { path: string; content: string }) {
            return Promise.resolve(
              handleFsWriteTextFile(p, options.cwd, options.additionalDirectories),
            );
          },
          async 'terminal/create'(p: {
            command: string;
            args?: string[];
            cwd?: string;
            env?: Record<string, string>;
            outputByteLimit?: number;
          }) {
            return handleTerminalCreate(
              p,
              activeTerminalManager,
              options.cwd,
              logger,
              callbacks.onEvent,
            );
          },
          async 'terminal/release'(p: { terminalId: string }) {
            return Promise.resolve(handleTerminalRelease(p, activeTerminalManager, logger));
          },
          async 'terminal/output'(p: { terminalId: string }) {
            return Promise.resolve(handleTerminalOutput(p, activeTerminalManager, logger));
          },
          async 'terminal/wait_for_exit'(p: { terminalId: string }) {
            return handleTerminalWaitForExit(p, activeTerminalManager, logger);
          },
          async 'terminal/kill'(p: { terminalId: string }) {
            return Promise.resolve(handleTerminalKill(p, activeTerminalManager, logger));
          },
          async 'terminal/write'(p: { terminalId: string; data: string }) {
            return Promise.resolve(handleTerminalWrite(p, activeTerminalManager, logger));
          },
          async 'builtin/bash'(p: {
            command: string;
            args?: string[];
            pty?: boolean;
            input?: string;
            cwd?: string;
          }) {
            return handleBuiltinBash(p, activeTerminalManager, options.cwd, logger);
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
                      const mcpClient = mcpGateway as {
                        callTool: (
                          serverId: string,
                          toolName: string,
                          args: Record<string, unknown>,
                        ) => Promise<unknown>;
                      };
                      return await mcpClient.callTool(serverId, toolName, args);
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
    let supportsEmbeddedContext = false;

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
        const promptParts = buildPromptBlocks({
          text,
          attachments,
          embeddedContext,
          supportsEmbeddedContext,
        });

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
      async updateConfigOption(
        configId: string,
        value: string | boolean,
      ): Promise<ACPConfigOption[]> {
        if (!this.acpSessionId) return [];
        if (typeof value === 'boolean') {
          const result = await connection.setSessionConfigOption({
            sessionId: this.acpSessionId,
            configId,
            type: 'boolean',
            value,
          });
          return result.configOptions as ACPConfigOption[];
        }
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
        const { parsedCapabilities } = await initializeAcpConnection(connection, {
          transport,
          timeoutMs: 60_000,
        });

        supportsResumeSession = parsedCapabilities.supportsResumeSession;
        supportsCloseSession = parsedCapabilities.supportsCloseSession;
        supportsDeleteSession = parsedCapabilities.supportsDeleteSession;
        supportsListSessions = parsedCapabilities.supportsListSessions;
        supportsAdditionalDirectories = parsedCapabilities.supportsAdditionalDirectories;
        supportsLoadSession = parsedCapabilities.supportsLoadSession;
        supportsEmbeddedContext = parsedCapabilities.supportsEmbeddedContext;
      }
      let newSessionResult:
        NewSessionResponse | ResumeSessionResponse | LoadSessionResponse | null = null;
      let acpSessionId: string | null = null;

      const baseSessionParams = buildBaseSessionParams({
        cwd: options.cwd,
        mcpServers: options.mcpServers,
        additionalDirectories: options.additionalDirectories,
        supportsAdditionalDirectories,
      });

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
        const resultModes =
          (newSessionResult as { modes?: { availableModes?: { id: string }[] } } | null)?.modes
            ?.availableModes ?? [];
        if (resultModes.length > 0) {
          handle.availableModes = resultModes.map((m) => m.id);
        } else {
          const opts = (newSessionResult as { configOptions?: SessionConfigOption[] } | null)
            ?.configOptions;
          if (opts) {
            const modeOpt = opts.find(
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
            const errorMsg = configErr instanceof Error ? configErr.message : String(configErr);
            this.logger.warn(
              configErr,
              `Failed to dynamically set model configuration on init (configId: ${options.resolvedModelConfigId})`,
            );
            void (callbacks.onEvent as (e: unknown) => Promise<void>)({
              type: 'status',
              status: 'config_option_error',
              configId: options.resolvedModelConfigId,
              value: options.selectedModel,
              error: errorMsg,
            });
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
    transport.closed.catch(() => undefined);

    const stream = this.wrapDebug(ndJsonStream(transport.stdin, transport.stdout));

    const connection = new ClientSideConnection(
      () => ({
        sessionUpdate() {
          return Promise.resolve();
        },
        requestPermission() {
          return Promise.resolve({
            outcome: { outcome: 'selected', optionId: 'allow-once' },
          });
        },
      }),
      stream,
    );

    try {
      const result = await Promise.race([
        (async (): Promise<AgentProbeResult> => {
          const { initResult } = await initializeAcpConnection(connection, {
            clientInfo: { name: 'agentctl-probe', version: '1.0.0' },
          });

          const typedInit = initResult as {
            agentCapabilities?: { auth?: { logout?: boolean } };
            authMethods?: AgentProbeResult['authMethods'];
          };
          const agentCapabilities = typedInit.agentCapabilities;
          const authMethods = typedInit.authMethods ?? [];

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

            supportsDynamicConfig = configOptions.length > 0;

            const modes = sessionResult.modes?.availableModes.map((m) => m.id);
            const supportsLogout = !!agentCapabilities?.auth?.logout;

            const probeResult: AgentProbeResult = {
              status,
              configOptions,
              authMethods,
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
            authMethods,
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
          return Promise.resolve({
            outcome: { outcome: 'selected', optionId: 'allow-once' },
          });
        },
      }),
      stream,
    );

    transport.closed.catch(() => undefined);

    try {
      const { parsedCapabilities } = await initializeAcpConnection(connectionInstance, {
        clientInfo: { name: 'agentctl-delete', version: '1.0.0' },
        timeoutMs: 10_000,
      });

      const supportsDelete = parsedCapabilities.supportsDeleteSession;
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

export class AcpDebugLog {
  private logs: { timestamp: Date; type: 'incoming' | 'outgoing' | 'stderr'; line: string }[] = [];

  recordLine(type: 'incoming' | 'outgoing' | 'stderr', line: string): void {
    this.logs.push({ timestamp: new Date(), type, line });
  }

  getLogs() {
    return this.logs;
  }
}
