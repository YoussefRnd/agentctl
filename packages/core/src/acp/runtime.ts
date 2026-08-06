import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  ClientSideConnection,
  ndJsonStream,
  type NewSessionResponse,
  type ResumeSessionResponse,
  type LoadSessionResponse,
  type SessionConfigOption,
  type Stream,
} from '@agentclientprotocol/sdk';
import { type Logger, noopLogger } from '../logger.js';
import type { ACPConfigOption } from '@agentctl/shared';
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
import { wrapDebug, formatAcpMessageLog } from './transport/stream-debug.js';
import {
  FileCacheStorage,
  getCacheKey,
  initializeAcpConnection,
  withTimeout,
} from './transport/capabilities-cache.js';
import { createClientHandlers } from './protocol/client-handlers.js';
import { TerminalManager } from './protocol/terminal-manager.js';
import { buildPromptBlocks } from './protocol/prompt.js';
import { buildBaseSessionParams } from './protocol/session-params.js';

export function isAuthRequiredError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof AuthRequiredError) return true;
  if (typeof err === 'string') {
    const lower = err.toLowerCase();
    return (
      lower.includes('auth') || lower.includes('unauthorized') || lower.includes('unauthenticated')
    );
  }
  if (typeof err === 'object') {
    const e = err as { code?: string | number; message?: string };
    if (e.code === 'auth_required' || e.code === 'needs_auth') return true;
    if (typeof e.message === 'string') {
      const lower = e.message.toLowerCase();
      return (
        lower.includes('authentication required') ||
        lower.includes('auth_required') ||
        lower.includes('needs_auth') ||
        lower.includes('unauthenticated') ||
        lower.includes('unauthorized')
      );
    }
  }
  return false;
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
      providerId =
        options.providerId ?? this.connectionManager.getProviderIdByCommand(command) ?? command;
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

      connection = new ClientSideConnection(
        () =>
          createClientHandlers({
            cwd: options.cwd,
            additionalDirectories: options.additionalDirectories,
            terminalManager: activeTerminalManager,
            logger,
            mcpGateway: options.mcpGateway,
            resolveSession: () => ({
              callbacks,
              cwd: options.cwd,
              additionalDirectories: options.additionalDirectories,
            }),
          }),
        stream,
      );
    }

    if (!isPersistent && terminalManager) {
      terminalManager.on('output', (event) => {
        const { terminalId, data } = event as { terminalId: string; data: string };
        void connection
          .extNotification('terminal/output', { terminalId, data })
          .catch((err: unknown) => {
            logger.warn(err, 'Failed to push terminal output notification to agent');
          });
        void callbacks.onEvent({ type: 'terminal_output', terminalId, data });
      });

      terminalManager.on('exit', (event) => {
        const { terminalId, code } = event as { terminalId: string; code: number | null };
        void connection
          .extNotification('terminal/exit', { terminalId, code })
          .catch((err: unknown) => {
            logger.warn(err, 'Failed to push terminal exit notification to agent');
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
          } else if (!isPersistent && supportsCloseSession && transport.isAlive) {
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
      async forkSession(_acpSessionId: string): Promise<string | null> {
        if (!this.acpSessionId) return null;
        try {
          const result = (await connection.unstable_forkSession({
            sessionId: this.acpSessionId,
            cwd: options.cwd,
          })) as { sessionId?: string };
          return result.sessionId ?? null;
        } catch {
          return null;
        }
      },
      async sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
        return connection.extMethod(method, params);
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
        supportsLoadSession = !!persistentConn.supportsLoadSession;
      } else {
        const { parsedCapabilities } = await initializeAcpConnection(connection, {
          transport,
          timeoutMs: 120_000,
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
        if (options.existingAgentSessionId && (supportsLoadSession || supportsResumeSession)) {
          acpSessionId = options.existingAgentSessionId;
          if (isPersistent && self.connectionManager) {
            self.connectionManager.registerActiveSession(
              acpSessionId,
              {
                acpSessionId,
                localSessionId: options.existingAgentSessionId,
                options,
                callbacks,
              },
              providerId,
            );
          }

          if (supportsLoadSession) {
            newSessionResult = await withTimeout(
              connection.loadSession({
                sessionId: options.existingAgentSessionId,
                ...baseSessionParams,
              }),
              60_000,
              'loading ACP session',
            );
          } else if (supportsResumeSession) {
            newSessionResult = await withTimeout(
              connection.resumeSession({
                sessionId: options.existingAgentSessionId,
                ...baseSessionParams,
              }),
              60_000,
              'resuming ACP session',
            );
          }
        } else {
          const created = await withTimeout(
            connection.newSession(baseSessionParams),
            60_000,
            'creating ACP session',
          );
          newSessionResult = created;
          acpSessionId = created.sessionId;
          if (isPersistent && self.connectionManager) {
            self.connectionManager.registerActiveSession(
              acpSessionId,
              {
                acpSessionId,
                localSessionId: options.existingAgentSessionId ?? '',
                options,
                callbacks,
              },
              providerId,
            );
          }
        }
      } catch (err: unknown) {
        if (isPersistent && acpSessionId && self.connectionManager) {
          self.connectionManager.unregisterActiveSession?.(acpSessionId);
        }
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
        self.connectionManager.registerActiveSession(
          finalSessionId,
          {
            acpSessionId: finalSessionId,
            localSessionId: options.existingAgentSessionId ?? '',
            options,
            callbacks,
          },
          providerId,
        );
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
          let status: 'ready' | 'needs_auth' = 'ready';
          let configOptions: ACPConfigOption[] = [];
          let supportsDynamicModel = false;
          let supportsDynamicConfig = false;
          let authMethods: AgentProbeResult['authMethods'] = [];
          let agentCapabilities: { auth?: { logout?: boolean } } | undefined;
          let modes: string[] | undefined;

          try {
            const { initResult } = await initializeAcpConnection(connection, {
              clientInfo: { name: 'agentctl-probe', version: '1.0.0' },
            });

            const typedInit = initResult as {
              agentCapabilities?: {
                auth?: { logout?: boolean };
                configOptions?: ACPConfigOption[];
              };
              authMethods?: AgentProbeResult['authMethods'];
            };
            agentCapabilities = typedInit.agentCapabilities;
            authMethods = typedInit.authMethods ?? [];

            const advertisedOptions = typedInit.agentCapabilities?.configOptions;

            if (advertisedOptions && advertisedOptions.length > 0) {
              // Prefer capabilities advertised during initialize: avoids
              // creating a real agent session just to probe.
              configOptions = advertisedOptions;
              supportsDynamicModel = advertisedOptions.some(
                (opt) => opt.id === 'model' || opt.id === 'selectedModel',
              );
              supportsDynamicConfig = true;
              const modeOption = advertisedOptions.find((opt) => opt.id === 'mode');
              modes = modeOption?.options?.map((opt) => opt.value);
            } else {
              const sessionResult = await connection.newSession({
                cwd: os.tmpdir(),
                mcpServers: [],
              });

              configOptions = extractConfigOptionsFromSessionResult(sessionResult);

              const hasAlternateModels = (sessionResult.models?.availableModels ?? []).length > 0;
              supportsDynamicModel = hasAlternateModels;
              supportsDynamicConfig = configOptions.length > 0;
              modes = sessionResult.modes?.availableModes.map((m) => m.id);
            }
          } catch (err: unknown) {
            if (isAuthRequiredError(err)) {
              status = 'needs_auth';
              const error = err as { data?: { configOptions?: ACPConfigOption[] } };
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
            modes,
            supportsLogout,
          };

          try {
            await cache.set(cacheKey, probeResult);
          } catch (cacheErr) {
            this.logger.warn(cacheErr, 'Failed to write to capabilities manifest cache');
          }

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

    return wrapDebug(stream, (direction, message) => {
      this.logger.debug(
        formatAcpMessageLog(direction === 'send' ? 'send' : 'recv', message),
        'ACP Frame',
      );
    });
  }
}

export function extractConfigOptionsFromSessionResult(sessionResult: {
  configOptions?: unknown;
  models?: {
    availableModels?: { modelId: string; name: string; description?: string | null }[];
    currentModelId?: string;
  } | null;
  modes?: {
    availableModes?: { id: string; name: string; description?: string | null }[];
    currentModeId?: string;
  } | null;
}): ACPConfigOption[] {
  const configOptions: ACPConfigOption[] = [];
  if (Array.isArray(sessionResult.configOptions) && sessionResult.configOptions.length > 0) {
    return sessionResult.configOptions as ACPConfigOption[];
  }
  const models = sessionResult.models;
  if (models?.availableModels && models.availableModels.length > 0) {
    configOptions.push({
      id: 'model',
      name: 'Model',
      description: 'Select the model to use',
      type: 'select',
      currentValue: models.currentModelId ?? '',
      options: models.availableModels.map((m) => ({
        value: m.modelId,
        name: m.name,
        description: m.description ?? undefined,
      })),
    });
  }
  const modesRes = sessionResult.modes;
  if (modesRes?.availableModes && modesRes.availableModes.length > 0) {
    configOptions.push({
      id: 'mode',
      name: 'Mode',
      description: 'Select the tool approval mode',
      type: 'select',
      currentValue: modesRes.currentModeId ?? '',
      options: modesRes.availableModes.map((m) => ({
        value: m.id,
        name: m.name,
        description: m.description ?? undefined,
      })),
    });
  }
  return configOptions;
}
