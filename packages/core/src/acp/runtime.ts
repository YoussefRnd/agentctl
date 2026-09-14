import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type NewSessionResponse,
  type ResumeSessionResponse,
  type LoadSessionResponse,
  type AgentCapabilities,
  type SessionConfigOption,
  type Stream,
} from '@agentclientprotocol/sdk';
import { type Logger, noopLogger } from '../logger.js';
import { createCapabilitySnapshot, type AgentConfigOption } from '@agentctl/shared';
import type { AgentStreamTransport, IConnectionManager, CacheStorage } from './types.js';
import type {
  AgentDescriptor,
  AgentDriver,
  AgentInspectionOptions,
  AgentPromptResult,
  AgentSession,
  AgentSessionCallbacks,
  AgentSessionOptions,
} from '../agent/types.js';
import { AgentAuthenticationRequiredError } from '../agent/errors.js';
import {
  ProcessStreamTransport,
  cleanEnv,
  spawnManagedProcess,
} from './transport/acp-process-lifecycle.js';
import { createAgentConnection } from './transport/process-transport.js';
import { wrapDebug, formatAcpMessageLog } from './transport/stream-debug.js';
import {
  FileCacheStorage,
  AGENTCTL_CLIENT_CAPABILITIES,
  getCacheKey,
  initializeAcpConnection,
  withTimeout,
  parseAcpCapabilities,
} from './transport/capabilities-cache.js';
import { projectConfigOption } from './protocol/events.js';
import { createClientHandlers } from './protocol/client-handlers.js';
import { TerminalManager } from './protocol/terminal-manager.js';
import { buildPromptBlocks } from './protocol/prompt.js';
import { buildBaseSessionParams } from './protocol/session-params.js';
import { forkProviderSession } from './protocol/session-fork.js';
import { normalizeAcpUsage } from './protocol/usage.js';
import { getAgentRequestTimeoutMs } from '../config/runtime-defaults.js';
import { authenticateConnection, initializeAuthConnection } from './protocol/auth.js';
import { isAcpAuthenticationRequired, isAcpSessionNotFound } from './protocol/error-classifier.js';
import type { AgentDiagnosticsRecorder } from '../agent/diagnostics.js';

export class AcpV1AgentDriver implements AgentDriver {
  private connectionManager?: IConnectionManager;

  constructor(
    private spawnImpl: typeof spawn = spawn,
    private logger: Logger = noopLogger,
    private createTransport: (child: ChildProcess, logger: Logger) => AgentStreamTransport = (
      child,
      logger,
    ) => new ProcessStreamTransport(child, logger),
    private cache?: CacheStorage,
    private diagnostics?: AgentDiagnosticsRecorder,
  ) {}

  setConnectionManager(manager: IConnectionManager): void {
    this.connectionManager = manager;
  }

  private getCache(): CacheStorage {
    if (this.cache) return this.cache;
    const defaultPath = path.join(os.homedir(), '.agentctl', 'capabilities-manifest.json');
    return new FileCacheStorage(defaultPath);
  }

  async startSession(
    command: string,
    args: string[],
    options: AgentSessionOptions,
    callbacks: AgentSessionCallbacks,
  ): Promise<AgentSession> {
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
        this.diagnostics?.record({
          kind: 'fallback_used',
          adapter: 'acp-v1',
          providerId,
          intent: options.intent.kind,
          path: 'spawn',
          reason: 'persistent_connection_unavailable',
        });
      }
    }

    const logger = this.logger;
    let terminalManager: TerminalManager | undefined;

    if (!isPersistent) {
      const managed = spawnManagedProcess({
        command,
        args,
        env: options.env,
        cwd: options.cwd,
        spawnImpl: this.spawnImpl,
        logger: this.logger,
        diagnostics: this.diagnostics,
        adapter: 'acp-v1',
        providerId: options.providerId,
        createTransport: this.createTransport,
      });
      child = managed.child;
      transport = managed.transport;

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
        void callbacks.onUpdate({ type: 'terminal_output', terminalId, data });
      });

      terminalManager.on('exit', (event) => {
        const { terminalId, code } = event as { terminalId: string; code: number | null };
        void callbacks.onUpdate({ type: 'terminal_exit', terminalId, code });
      });
    }

    let capabilities = parseAcpCapabilities(undefined);

    const handle: AgentSession = {
      id: null,
      history: 'fresh',
      closed: Promise.race([connection.closed, transport.closed]),
      onError(handler) {
        child.on('error', handler);
      },
      onClose(handler) {
        child.once('exit', (code, signal) => handler({ code, signal }));
      },
      async prompt(
        text: string,
        attachments?: { filePath: string; mimeType: string }[],
        embeddedContext?: string,
      ): Promise<AgentPromptResult> {
        const promptParts = await buildPromptBlocks({
          text,
          attachments,
          embeddedContext,
          supportsImage: capabilities.supportsImage,
          supportsAudio: capabilities.supportsAudio,
          supportsEmbeddedContext: capabilities.supportsEmbeddedContext,
        });

        const response = await connection.prompt({
          sessionId: this.id ?? '',
          prompt: promptParts,
        });
        return {
          stopReason: response.stopReason,
          usage: normalizeAcpUsage(response.usage),
        };
      },
      async authenticate(methodId: string): Promise<void> {
        await (connection.authenticate({ methodId }) as Promise<unknown>);
      },
      async cancel(): Promise<void> {
        if (this.id) {
          await (connection.cancel({ sessionId: this.id }) as Promise<unknown>);
        }
      },
      async close(): Promise<void> {
        if (this.id) {
          if (isPersistent && self.connectionManager) {
            await self.connectionManager.closeSession(providerId, this.id);
          } else if (!isPersistent && capabilities.supportsCloseSession && transport.isAlive) {
            try {
              await withTimeout(
                connection.closeSession({ sessionId: this.id }),
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
        if (this.id && options.resolvedModelConfigId) {
          await connection.setSessionConfigOption({
            sessionId: this.id,
            configId: options.resolvedModelConfigId,
            value: modelId,
          });
        }
      },
      async updateConfigOption(
        configId: string,
        value: string | boolean,
      ): Promise<AgentConfigOption[]> {
        if (!this.id) return [];
        if (typeof value === 'boolean') {
          const result = await connection.setSessionConfigOption({
            sessionId: this.id,
            configId,
            type: 'boolean',
            value,
          });
          return result.configOptions as AgentConfigOption[];
        }
        const result = await connection.setSessionConfigOption({
          sessionId: this.id,
          configId,
          value,
        });
        return result.configOptions as AgentConfigOption[];
      },
      async setMode(modeId: string): Promise<void> {
        if (this.id) {
          await connection.setSessionMode({
            sessionId: this.id,
            modeId,
          });
        }
      },
      async deleteSession(acpSessionId: string): Promise<void> {
        if (capabilities.supportsDeleteSession) {
          await withTimeout(
            connection.deleteSession({ sessionId: acpSessionId }),
            5000,
            'deleting ACP session',
          );
        }
      },
      async listSessions(params?: {
        cwd?: string;
        cursor?: string;
      }): Promise<{ sessions: unknown[]; nextCursor?: string }> {
        if (!capabilities.supportsListSessions) return { sessions: [] };
        const result = await withTimeout(
          connection.listSessions(params ?? {}),
          5000,
          'listing ACP sessions',
        );
        return { sessions: result.sessions, nextCursor: result.nextCursor ?? undefined };
      },
      async logout(): Promise<void> {
        await connection.logout({});
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
        capabilities = persistentConn.capabilities;
      } else {
        const { parsedCapabilities } = await initializeAcpConnection(connection, {
          transport,
          timeoutMs: 120_000,
          clientCapabilities: AGENTCTL_CLIENT_CAPABILITIES,
        });

        capabilities = parsedCapabilities;
        this.diagnostics?.record({
          kind: 'connection_ready',
          adapter: 'acp-v1',
          providerId: options.providerId,
          path: 'spawn',
        });
      }
      let newSessionResult:
        NewSessionResponse | ResumeSessionResponse | LoadSessionResponse | null = null;
      let acpSessionId: string | null = null;

      const baseSessionParams = buildBaseSessionParams({
        cwd: options.cwd,
        mcpServers: options.mcpServers,
        additionalDirectories: options.additionalDirectories,
        supportsAdditionalDirectories: capabilities.supportsAdditionalDirectories,
      });

      try {
        const forked =
          options.intent.kind === 'fork'
            ? await forkProviderSession(
                connection,
                capabilities,
                { sessionId: options.intent.sessionId, ...baseSessionParams },
                getAgentRequestTimeoutMs(),
              )
            : null;
        if (forked) {
          newSessionResult = forked;
          acpSessionId = forked.sessionId;
          handle.history = 'restored';
          this.diagnostics?.record({
            kind: 'session_started',
            adapter: 'acp-v1',
            providerId,
            intent: 'fork',
            path: 'provider_fork',
          });
        } else if (
          options.intent.kind === 'resume' &&
          (capabilities.supportsLoadSession || capabilities.supportsResumeSession)
        ) {
          acpSessionId = options.intent.sessionId;
          if (isPersistent && self.connectionManager) {
            self.connectionManager.registerActiveSession(
              acpSessionId,
              {
                acpSessionId,
                localSessionId: options.localSessionId ?? '',
                options,
                callbacks,
              },
              providerId,
            );
          }

          try {
            if (capabilities.supportsResumeSession) {
              newSessionResult = await withTimeout(
                connection.resumeSession({
                  sessionId: options.intent.sessionId,
                  ...baseSessionParams,
                }),
                getAgentRequestTimeoutMs(),
                'resuming ACP session',
              );
              handle.history = 'restored';
              this.diagnostics?.record({
                kind: 'session_started',
                adapter: 'acp-v1',
                providerId,
                intent: 'resume',
                path: 'provider_resume',
              });
            } else if (capabilities.supportsLoadSession) {
              newSessionResult = await withTimeout(
                connection.loadSession({
                  sessionId: options.intent.sessionId,
                  ...baseSessionParams,
                }),
                getAgentRequestTimeoutMs(),
                'loading ACP session',
              );
              handle.history = 'restored';
              this.diagnostics?.record({
                kind: 'session_started',
                adapter: 'acp-v1',
                providerId,
                intent: 'resume',
                path: 'provider_resume',
              });
            }
          } catch (resumeErr: unknown) {
            if (isAcpSessionNotFound(resumeErr)) {
              this.logger.warn(
                { sessionId: options.intent.sessionId, err: resumeErr },
                'Existing ACP session not found on agent process. Falling back to creating a new session.',
              );
              if (isPersistent && acpSessionId && self.connectionManager) {
                self.connectionManager.unregisterActiveSession?.(acpSessionId);
              }
              const created = await withTimeout(
                connection.newSession(baseSessionParams),
                getAgentRequestTimeoutMs(),
                'creating ACP session (fallback)',
              );
              newSessionResult = created;
              acpSessionId = created.sessionId;
              handle.history = 'fresh';
              this.diagnostics?.record({
                kind: 'fallback_used',
                adapter: 'acp-v1',
                providerId,
                intent: 'resume',
                path: 'fresh_session',
                reason: 'session_not_found',
              });
              if (isPersistent && self.connectionManager) {
                self.connectionManager.registerActiveSession(
                  acpSessionId,
                  {
                    acpSessionId,
                    localSessionId: options.localSessionId ?? '',
                    options,
                    callbacks,
                  },
                  providerId,
                );
              }
            } else {
              throw resumeErr;
            }
          }
        } else {
          if (options.intent.kind === 'fork') {
            this.diagnostics?.record({
              kind: 'fallback_used',
              adapter: 'acp-v1',
              providerId,
              intent: 'fork',
              path: 'fresh_session',
              reason: capabilities.supportsForkSession
                ? 'fork_method_not_found'
                : 'fork_not_supported',
            });
          }
          const created = await withTimeout(
            connection.newSession(baseSessionParams),
            getAgentRequestTimeoutMs(),
            'creating ACP session',
          );
          newSessionResult = created;
          acpSessionId = created.sessionId;
          if (options.intent.kind === 'new') {
            this.diagnostics?.record({
              kind: 'session_started',
              adapter: 'acp-v1',
              providerId,
              intent: 'new',
              path: 'fresh_session',
            });
          }
          if (isPersistent && self.connectionManager) {
            self.connectionManager.registerActiveSession(
              acpSessionId,
              {
                acpSessionId,
                localSessionId: options.localSessionId ?? '',
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
        const error = err as { code?: string; data?: { configOptions?: AgentConfigOption[] } };
        if (isAcpAuthenticationRequired(error)) {
          throw new AgentAuthenticationRequiredError(handle, error.data?.configOptions ?? []);
        }
        throw err;
      }

      handle.id = acpSessionId;

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

      const finalSessionId = handle.id;
      if (finalSessionId) {
        if (
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
            void (callbacks.onUpdate as (e: unknown) => Promise<void>)({
              type: 'status',
              status: 'config_option_error',
              configId: options.resolvedModelConfigId,
              value: options.selectedModel,
              error: errorMsg,
            });
          }
        }

        if (
          options.features?.configuration.options &&
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
            localSessionId: options.localSessionId ?? '',
            options,
            callbacks,
          },
          providerId,
        );
      }

      return handle;
    } catch (err) {
      if (err instanceof AgentAuthenticationRequiredError) {
        throw err;
      }
      await handle.close();
      throw err;
    }
  }

  async inspectProvider(
    command: string,
    args: string[],
    env?: Record<string, string>,
    options?: AgentInspectionOptions,
  ): Promise<AgentDescriptor> {
    const cleanEnvObj = cleanEnv(env);
    const cacheIdentity = {
      providerVersion: options?.providerVersion,
      protocolVersion: String(PROTOCOL_VERSION),
    };
    const cacheKey = getCacheKey(command, args, cleanEnvObj, cacheIdentity);
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

    const managed = spawnManagedProcess({
      command,
      args,
      env: cleanEnvObj,
      cwd: os.tmpdir(),
      spawnImpl: this.spawnImpl,
      logger: this.logger,
      createTransport: this.createTransport,
    });
    const { transport } = managed;
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
        (async (): Promise<AgentDescriptor> => {
          let status: 'ready' | 'needs_auth' = 'ready';
          let configOptions: AgentConfigOption[] = [];
          let supportsDynamicModel = false;
          let supportsDynamicConfig = false;
          let authMethods: AgentDescriptor['authMethods'] = [];
          let agentCapabilities: AgentCapabilities | undefined;
          let parsedCapabilities = parseAcpCapabilities(undefined);
          let modes: string[] | undefined;

          try {
            const initialized = await initializeAcpConnection(connection, {
              clientInfo: { name: 'agentctl-probe', version: '1.0.0' },
            });
            const { initResult } = initialized;
            parsedCapabilities = initialized.parsedCapabilities;

            agentCapabilities = initResult.agentCapabilities;
            authMethods = (initResult.authMethods ?? []).map((method) => ({
              id: method.id,
              name: method.name,
              type: 'agent' as const,
              description: method.description ?? null,
            }));

            const sessionResult = await connection.newSession({
              cwd: os.tmpdir(),
              mcpServers: [],
            });

            configOptions = extractConfigOptionsFromSessionResult(sessionResult);
            supportsDynamicModel = configOptions.some(
              (option) => option.id === 'model' || option.id === 'selectedModel',
            );
            supportsDynamicConfig = configOptions.length > 0;
            modes = sessionResult.modes?.availableModes.map((mode) => mode.id);
          } catch (err: unknown) {
            if (isAcpAuthenticationRequired(err)) {
              status = 'needs_auth';
              const error = err as { data?: { configOptions?: AgentConfigOption[] } };
              if (error.data?.configOptions) {
                configOptions = error.data.configOptions;
              }
            } else {
              throw err;
            }
          }

          const supportsLogout = !!agentCapabilities?.auth?.logout;

          const probeResult: AgentDescriptor = {
            status,
            configOptions,
            authMethods,
            supportsDynamicModel,
            supportsDynamicConfig,
            modes,
            supportsLogout,
            features: {
              sessions: {
                resume:
                  parsedCapabilities.supportsResumeSession ||
                  parsedCapabilities.supportsLoadSession,
                fork: parsedCapabilities.supportsForkSession,
                delete: parsedCapabilities.supportsDeleteSession,
                list: parsedCapabilities.supportsListSessions,
              },
              prompts: {
                image: parsedCapabilities.supportsImage,
                audio: parsedCapabilities.supportsAudio,
                embeddedContext: parsedCapabilities.supportsEmbeddedContext,
              },
              configuration: {
                model: supportsDynamicModel,
                options: supportsDynamicConfig,
              },
              authentication: { logout: supportsLogout },
            },
          };
          probeResult.snapshot = createCapabilitySnapshot(probeResult.features!, 'handshake', {
            ...cacheIdentity,
            commandHash: cacheKey,
          });

          if (status === 'ready') {
            try {
              await cache.set(cacheKey, probeResult);
            } catch (cacheErr) {
              this.logger.warn(cacheErr, 'Failed to write to capabilities manifest cache');
            }
          }

          return probeResult;
        })(),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error('Probe timed out'));
          }, getAgentRequestTimeoutMs());
        }),
      ]);

      return result;
    } finally {
      transport.kill();
    }
  }

  async deleteSession(
    command: string,
    args: string[],
    env: Record<string, string> | undefined,
    acpSessionId: string,
  ): Promise<void> {
    const managed = spawnManagedProcess({
      command,
      args,
      env,
      cwd: os.tmpdir(),
      spawnImpl: this.spawnImpl,
      logger: this.logger,
      createTransport: this.createTransport,
    });
    const { transport } = managed;
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
        clientCapabilities: {},
      });

      const supportsDelete = parsedCapabilities.supportsDeleteSession;
      if (supportsDelete) {
        await withTimeout(
          connectionInstance.deleteSession({ sessionId: acpSessionId }),
          10_000,
          'sending session/delete request',
        );
      }
    } finally {
      transport.kill();
      await transport.closed.catch(() => undefined);
    }
  }

  async invalidateProviderCache(
    command: string,
    args: string[],
    env?: Record<string, string>,
    options?: AgentInspectionOptions,
  ): Promise<void> {
    const cleanEnvObj = cleanEnv(env);
    const cacheKey = getCacheKey(command, args, cleanEnvObj, {
      providerVersion: options?.providerVersion,
      protocolVersion: String(PROTOCOL_VERSION),
    });
    const cache = this.getCache();
    await cache.delete?.(cacheKey);
  }

  async authenticateProvider(
    command: string,
    args: string[],
    env: Record<string, string> | undefined,
    methodId: string,
    params: Record<string, unknown> = {},
  ): Promise<void> {
    const providerId = this.connectionManager?.getProviderIdByCommand(command);
    if (providerId && this.connectionManager) {
      const persistent = await this.connectionManager.getConnection(providerId);
      await authenticateConnection(persistent.connection, methodId, params);
      return;
    }
    const { child, connection } = createAgentConnection(
      command,
      args,
      cleanEnv(env),
      this.spawnImpl,
    );
    try {
      await initializeAuthConnection(connection, 'agentctl-login');
      await authenticateConnection(connection, methodId, params);
    } finally {
      child.kill();
    }
  }

  async logoutProvider(
    command: string,
    args: string[],
    env?: Record<string, string>,
  ): Promise<void> {
    const providerId = this.connectionManager?.getProviderIdByCommand(command);
    if (providerId && this.connectionManager) {
      const persistent = await this.connectionManager.getConnection(providerId);
      await persistent.connection.logout({});
      return;
    }
    const { child, connection } = createAgentConnection(
      command,
      args,
      cleanEnv(env),
      this.spawnImpl,
    );
    try {
      await initializeAuthConnection(connection, 'agentctl-logout');
      await connection.logout({});
    } finally {
      child.kill();
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
}): AgentConfigOption[] {
  const configOptions: AgentConfigOption[] = [];

  if (Array.isArray(sessionResult.configOptions) && sessionResult.configOptions.length > 0) {
    for (const opt of sessionResult.configOptions) {
      if (opt && typeof opt === 'object' && 'id' in opt && 'type' in opt) {
        configOptions.push(projectConfigOption(opt as SessionConfigOption));
      }
    }
  }

  const hasModelOption = configOptions.some(
    (opt) => opt.id === 'model' || opt.id === 'selectedModel',
  );
  const models = sessionResult.models;
  if (!hasModelOption && models?.availableModels && models.availableModels.length > 0) {
    configOptions.push({
      id: 'model',
      name: 'Model',
      description: 'Select the model to use',
      type: 'select',
      currentValue: models.currentModelId ?? models.availableModels[0].modelId,
      options: models.availableModels.map((m) => ({
        value: m.modelId,
        name: m.name,
        description: m.description ?? undefined,
      })),
    });
  }

  const hasModeOption = configOptions.some((opt) => opt.id === 'mode');
  const modesRes = sessionResult.modes;
  if (!hasModeOption && modesRes?.availableModes && modesRes.availableModes.length > 0) {
    configOptions.push({
      id: 'mode',
      name: 'Mode',
      description: 'Select the tool approval mode',
      type: 'select',
      currentValue: modesRes.currentModeId ?? modesRes.availableModes[0].id,
      options: modesRes.availableModes.map((m) => ({
        value: m.id,
        name: m.name,
        description: m.description ?? undefined,
      })),
    });
  }

  return configOptions;
}
