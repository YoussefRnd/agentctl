import { applicationInfo } from '../config/application-info.js';
import { drainableCallbacks } from './transport/update-drain.js';
import { withProcessDiagnostics } from './transport/stderr.js';
import { withCustomModels } from '@agentctl/shared';
import { guardAcpTurns } from './transport/turn-control.js';
import { cancellableCallbacks } from './transport/session-requests.js';
import {
  ACP_SESSION_CLOSE_TIMEOUT_MS,
  ACP_SESSION_OPERATION_TIMEOUT_MS,
} from './transport/limits.js';
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
import {
  findAgentConfigOption,
  createCapabilitySnapshot,
  type AgentConfigOption,
} from '@agentctl/shared';
import type { AgentStreamTransport, IConnectionManager, CacheStorage } from './types.js';
import type {
  AgentDescriptor,
  AgentAuthenticationOptions,
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
  bindSessionProcessEvents,
  terminateChildProcess,
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
import { connectAcpClient, type AcpAgentConnection } from './transport/client-connection.js';
import { TerminalManager } from './protocol/terminal-manager.js';
import { buildPromptBlocks } from './protocol/prompt.js';
import { buildBaseSessionParams } from './protocol/session-params.js';
import { forkProviderSession } from './protocol/session-fork.js';
import { normalizeAcpUsage } from './protocol/usage.js';
import {
  getAgentRequestTimeoutMs,
  DEFAULT_PROVIDER_AUTH_TIMEOUT_MS,
  DEFAULT_AGENT_INITIALIZATION_TIMEOUT_MS,
  DEFAULT_AGENT_MODEL,
} from '../config/runtime-defaults.js';
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
    const requests = cancellableCallbacks(callbacks);
    const applicationCallbacks = requests.callbacks;
    const updates = drainableCallbacks({
      ...applicationCallbacks,
      onUpdate(event) {
        if (event.type === 'config_option_update') {
          event.configOptions = withCustomModels(event.configOptions, options.customModels ?? []);
          handle.configOptions = event.configOptions;
        }
        return applicationCallbacks.onUpdate(event);
      },
    });
    callbacks = updates.callbacks;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    let child!: ChildProcess;
    let transport!: AgentStreamTransport;
    let connection!: AcpAgentConnection;
    let isPersistent = false;
    let providerId = '';
    let legacyModelSelection = false;
    let acpSessionId: string | null =
      options.intent.kind === 'resume' ? options.intent.sessionId : null;
    const terminalCallbacks = new Map<string, AgentSessionCallbacks>();

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

      connection = await connectAcpClient(
        {
          cwd: options.cwd,
          additionalDirectories: options.additionalDirectories,
          terminalManager: activeTerminalManager,
          logger,
          mcpGateway: options.mcpGateway,
          onRootSession: (id) => {
            acpSessionId = id;
          },
          resolveSession: (params) => {
            if (!params?.sessionId || params.sessionId !== acpSessionId)
              throw new Error('Unknown ACP root session');
            return {
              localSessionId: options.localSessionId,
              callbacks,
              cwd: options.cwd,
              additionalDirectories: options.additionalDirectories,
              onTerminalCreated: (id, owner) => {
                terminalCallbacks.set(id, owner);
              },
            };
          },
        },
        stream,
      ).catch(async (error: unknown) => {
        transport.kill();
        await activeTerminalManager.dispose();
        throw error;
      });
    }

    if (!isPersistent && terminalManager) {
      void connection.closed
        .finally(() => {
          requests.cancel();
          terminalCallbacks.clear();
          return terminalManager?.dispose();
        })
        .catch(() => undefined);
      terminalManager.on('output', (event) => {
        const { terminalId, data } = event as { terminalId: string; data: string };
        void terminalCallbacks
          .get(terminalId)
          ?.onUpdate({ type: 'terminal_output', terminalId, data });
      });

      terminalManager.on('exit', (event) => {
        const { terminalId, code } = event as { terminalId: string; code: number | null };
        void terminalCallbacks
          .get(terminalId)
          ?.onUpdate({ type: 'terminal_exit', terminalId, code });
      });
    }

    let capabilities = parseAcpCapabilities(undefined);
    const processEvents = bindSessionProcessEvents(child);

    const handle: AgentSession = {
      id: null,
      history: 'fresh',
      closed: Promise.race([connection.closed, transport.closed]),
      onError: processEvents.onError,
      onClose: processEvents.onClose,
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

        const response = await connection
          .prompt({
            sessionId: this.id ?? '',
            prompt: promptParts,
          })
          .catch(async (error: unknown) => {
            await updates.drain().catch(() => undefined);
            throw withProcessDiagnostics(error, child);
          });
        await updates.drain();
        return {
          stopReason: response.stopReason,
          usage: normalizeAcpUsage(response.usage),
        };
      },
      async authenticate(methodId: string): Promise<void> {
        await withTimeout(
          connection.authenticate({ methodId }),
          DEFAULT_PROVIDER_AUTH_TIMEOUT_MS,
          'authenticating ACP session',
        );
      },
      async cancel(): Promise<void> {
        if (this.id) {
          await (connection.cancel({ sessionId: this.id }) as Promise<unknown>);
        }
      },
      async close(): Promise<void> {
        requests.cancel();
        processEvents.dispose();
        if (this.id) {
          if (isPersistent && self.connectionManager) {
            await self.connectionManager.closeSession(providerId, this.id);
          } else if (!isPersistent && capabilities.supportsCloseSession && transport.isAlive) {
            try {
              await withTimeout(
                connection.closeSession({ sessionId: this.id }),
                ACP_SESSION_CLOSE_TIMEOUT_MS,
                'closing ACP session',
              );
            } catch {
              // Ignore error on close, we still want to kill the process
            }
          }
        }
        if (!isPersistent) {
          connection.close?.();
          transport.kill();
          if (terminalManager) {
            await terminalManager.dispose();
          }
        }
      },
      async updateModel(modelId: string): Promise<AgentConfigOption[] | undefined> {
        const configId =
          findAgentConfigOption(this.configOptions, 'model')?.id ?? options.resolvedModelConfigId;
        if (!this.id || !configId) return undefined;
        if (legacyModelSelection) {
          await withTimeout(
            connection.request('session/set_model', { sessionId: this.id, modelId }),
            getAgentRequestTimeoutMs(),
            'setting legacy ACP model',
          );
          return (this.configOptions = this.configOptions?.map((option) =>
            option.id === configId ? { ...option, currentValue: modelId } : option,
          ));
        }
        const result = await withTimeout(
          connection.setSessionConfigOption({
            sessionId: this.id,
            configId,
            value: modelId,
          }),
          getAgentRequestTimeoutMs(),
          'setting ACP model',
        );
        if (!Array.isArray(result.configOptions)) return undefined;
        return (this.configOptions = withCustomModels(
          extractConfigOptionsFromSessionResult(result),
          options.customModels ?? [],
        ));
      },
      async updateConfigOption(
        configId: string,
        value: string | boolean,
      ): Promise<AgentConfigOption[]> {
        if (!this.id) return [];
        if (typeof value === 'boolean') {
          const result = await withTimeout(
            connection.setSessionConfigOption({
              sessionId: this.id,
              configId,
              type: 'boolean',
              value,
            }),
            getAgentRequestTimeoutMs(),
            'setting ACP configuration',
          );
          return (this.configOptions = withCustomModels(
            extractConfigOptionsFromSessionResult(result),
            options.customModels ?? [],
          ));
        }
        const result = await withTimeout(
          connection.setSessionConfigOption({
            sessionId: this.id,
            configId,
            value,
          }),
          getAgentRequestTimeoutMs(),
          'setting ACP configuration',
        );
        return (this.configOptions = withCustomModels(
          extractConfigOptionsFromSessionResult(result),
          options.customModels ?? [],
        ));
      },
      async setMode(modeId: string): Promise<void> {
        if (this.id) {
          await withTimeout(
            connection.setSessionMode({
              sessionId: this.id,
              modeId,
            }),
            getAgentRequestTimeoutMs(),
            'setting ACP mode',
          );
        }
      },
      async deleteSession(acpSessionId: string): Promise<void> {
        if (capabilities.supportsDeleteSession) {
          await withTimeout(
            connection.deleteSession({ sessionId: acpSessionId }),
            ACP_SESSION_OPERATION_TIMEOUT_MS,
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
          ACP_SESSION_OPERATION_TIMEOUT_MS,
          'listing ACP sessions',
        );
        return { sessions: result.sessions, nextCursor: result.nextCursor ?? undefined };
      },
      async logout(): Promise<void> {
        await withTimeout(
          connection.logout({}),
          ACP_SESSION_OPERATION_TIMEOUT_MS,
          'logging out of ACP session',
        );
      },
      writeTerminalInput(terminalId: string, data: string): boolean {
        if (isPersistent && self.connectionManager) {
          return self.connectionManager.writeTerminalInput(terminalId, data);
        }
        return terminalManager ? terminalManager.write(terminalId, data) : false;
      },
    };
    void handle.closed?.finally(() => processEvents.dispose()).catch(() => undefined);

    try {
      if (isPersistent && self.connectionManager) {
        const persistentConn = await self.connectionManager.getConnection(providerId);
        capabilities = persistentConn.capabilities;
      } else {
        const { parsedCapabilities } = await initializeAcpConnection(connection, {
          transport,
          timeoutMs: DEFAULT_AGENT_INITIALIZATION_TIMEOUT_MS,
          clientCapabilities: {
            ...AGENTCTL_CLIENT_CAPABILITIES,
            elicitation: callbacks.onRequestElicitation
              ? AGENTCTL_CLIENT_CAPABILITIES.elicitation
              : undefined,
          },
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

      const baseSessionParams = buildBaseSessionParams({
        cwd: options.cwd,
        mcpServers: options.mcpServers,
        additionalDirectories: options.additionalDirectories,
        supportsAdditionalDirectories: capabilities.supportsAdditionalDirectories,
        supportsMcpHttp: capabilities.supportsMcpHttp,
        supportsMcpSse: capabilities.supportsMcpSse,
        supportsMcpAcp: capabilities.supportsMcpAcp,
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
            if (
              capabilities.supportsResumeSession &&
              !(options.intent.requireExisting && capabilities.supportsLoadSession)
            ) {
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
            if (options.intent.kind === 'resume' && options.intent.requireExisting) throw resumeErr;
            if (isAcpSessionNotFound(resumeErr)) {
              this.logger.warn(
                { sessionId: options.intent.sessionId, err: resumeErr },
                'Existing ACP session not found on agent process. Falling back to creating a new session.',
              );
              if (isPersistent && acpSessionId && self.connectionManager) {
                self.connectionManager.unregisterActiveSession?.(acpSessionId, providerId);
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
          if (options.intent.kind === 'resume' && options.intent.requireExisting)
            throw new Error('Agent does not support loading this native session');
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
          self.connectionManager.unregisterActiveSession?.(acpSessionId, providerId);
        }
        const error = err as { code?: string; data?: { configOptions?: AgentConfigOption[] } };
        if (isAcpAuthenticationRequired(error)) {
          throw new AgentAuthenticationRequiredError(handle, error.data?.configOptions ?? []);
        }
        throw err;
      }

      handle.id = acpSessionId;
      await connection.flushPendingSessionUpdates?.();
      if (newSessionResult) {
        const rawSession = newSessionResult as Parameters<
          typeof extractConfigOptionsFromSessionResult
        >[0];
        legacyModelSelection =
          !!rawSession.models?.availableModels?.length &&
          !findAgentConfigOption(
            extractConfigOptionsFromSessionResult({ configOptions: rawSession.configOptions }),
            'model',
          );
        handle.configOptions = withCustomModels(
          extractConfigOptionsFromSessionResult(newSessionResult),
          options.customModels ?? [],
        );
      }

      if (!handle.availableModes || handle.availableModes.length === 0) {
        const resultModes =
          (newSessionResult as { modes?: { availableModes?: { id: string }[] } } | null)?.modes
            ?.availableModes ?? [];
        if (resultModes.length > 0) {
          handle.availableModes = resultModes.map((m) => m.id);
        } else {
          handle.availableModes = findAgentConfigOption(handle.configOptions, 'mode')?.options?.map(
            (option) => option.value,
          );
        }
      }

      const finalSessionId = handle.id;
      if (finalSessionId) {
        const modelConfigId =
          findAgentConfigOption(handle.configOptions, 'model')?.id ?? options.resolvedModelConfigId;
        if (
          options.selectedModel &&
          options.selectedModel !== DEFAULT_AGENT_MODEL &&
          modelConfigId
        ) {
          try {
            await handle.updateModel?.(options.selectedModel);
          } catch (configErr) {
            if (options.customModels?.some((model) => model.id === options.selectedModel))
              throw configErr;
            const errorMsg = configErr instanceof Error ? configErr.message : String(configErr);
            this.logger.warn(
              configErr,
              `Failed to dynamically set model configuration on init (configId: ${modelConfigId})`,
            );
            void (callbacks.onUpdate as (e: unknown) => Promise<void>)({
              type: 'status',
              status: 'config_option_error',
              configId: modelConfigId,
              value: options.selectedModel,
              error: errorMsg,
            });
          }
        }

        const thinkingConfigId =
          findAgentConfigOption(handle.configOptions, 'thought_level')?.id ??
          options.resolvedThinkingConfigId;

        if (
          options.features?.configuration.options &&
          options.selectedThinkingEffort &&
          thinkingConfigId &&
          (!handle.configOptions ||
            handle.configOptions.some(
              (option) =>
                option.id === thinkingConfigId &&
                option.options?.some((choice) => choice.value === options.selectedThinkingEffort),
            ))
        ) {
          try {
            const result = await withTimeout(
              connection.setSessionConfigOption({
                sessionId: finalSessionId,
                configId: thinkingConfigId,
                value: options.selectedThinkingEffort,
              }),
              getAgentRequestTimeoutMs(),
              'setting initial ACP thinking effort',
            );
            if (Array.isArray(result.configOptions)) {
              handle.configOptions = withCustomModels(
                extractConfigOptionsFromSessionResult(result),
                options.customModels ?? [],
              );
            }
          } catch (configErr) {
            this.logger.warn(
              configErr,
              `Failed to dynamically set thinking effort on init (configId: ${thinkingConfigId})`,
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

      guardAcpTurns(handle, () => transport.kill(), { requests });
      return handle;
    } catch (err) {
      if (err instanceof AgentAuthenticationRequiredError) {
        throw err;
      }
      await handle.close();
      throw withProcessDiagnostics(err, child);
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
            outcome: { outcome: 'cancelled' },
          });
        },
      }),
      stream,
    );

    try {
      const result = await withTimeout(
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
              clientInfo: applicationInfo('agentctl-probe'),
            });
            const { initResult } = initialized;
            parsedCapabilities = initialized.parsedCapabilities;

            agentCapabilities = initResult.agentCapabilities;
            authMethods = (initResult.authMethods ?? []).map((method) => {
              if ((method as { type?: string }).type === 'terminal') {
                const term = method as {
                  id: string;
                  name: string;
                  type: 'terminal';
                  description?: string | null;
                  args?: string[];
                  env?: Record<string, string>;
                };
                return {
                  id: term.id,
                  name: term.name,
                  type: 'terminal' as const,
                  description: term.description ?? null,
                  args: term.args,
                  env: term.env,
                };
              }
              return {
                id: method.id,
                name: method.name,
                type: 'agent' as const,
                description: method.description ?? null,
              };
            });

            const sessionResult = await connection.newSession({
              cwd: os.tmpdir(),
              mcpServers: [],
            });

            configOptions = extractConfigOptionsFromSessionResult(sessionResult);
            supportsDynamicModel = !!findAgentConfigOption(configOptions, 'model');
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
        getAgentRequestTimeoutMs(),
        'probing provider',
      );

      return result;
    } catch (error) {
      throw withProcessDiagnostics(error, transport.child);
    } finally {
      transport.kill();
    }
  }

  async listSessions(
    command: string,
    args: string[],
    env: Record<string, string> | undefined,
    params: { cwd?: string; cursor?: string },
  ): Promise<{ sessions: unknown[]; nextCursor?: string }> {
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
            outcome: { outcome: 'cancelled' },
          });
        },
      }),
      stream,
    );

    transport.closed.catch(() => undefined);

    try {
      const { parsedCapabilities } = await initializeAcpConnection(connectionInstance, {
        clientInfo: applicationInfo('agentctl-list'),
        timeoutMs: 10_000,
        clientCapabilities: {},
      });

      if (!parsedCapabilities.supportsListSessions)
        throw new Error('Agent does not support native session listing');
      const result = await withTimeout(
        connectionInstance.listSessions(params),
        10_000,
        'listing native ACP sessions',
      );
      return { sessions: result.sessions, nextCursor: result.nextCursor ?? undefined };
    } finally {
      transport.kill();
      await transport.closed.catch(() => undefined);
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
            outcome: { outcome: 'cancelled' },
          });
        },
      }),
      stream,
    );

    transport.closed.catch(() => undefined);

    try {
      const { parsedCapabilities } = await initializeAcpConnection(connectionInstance, {
        clientInfo: applicationInfo('agentctl-delete'),
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
    options: AgentAuthenticationOptions = {},
  ): Promise<void> {
    const { child, connection } = createAgentConnection(
      command,
      args,
      cleanEnv(env),
      this.spawnImpl,
      options,
    );
    const abort = () => terminateChildProcess(child, this.logger);
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
      if (options.signal?.aborted) throw new Error('Authentication cancelled');
      const initResult = await withTimeout(
        initializeAuthConnection(connection, 'agentctl-login'),
        options.timeoutMs ?? DEFAULT_PROVIDER_AUTH_TIMEOUT_MS,
        'initializing authentication',
      );
      const targetMethod = initResult.authMethods?.find((m) => m.id === methodId);
      if (!targetMethod) {
        throw new Error(`Authentication method '${methodId}' was not advertised by the agent`);
      }
      if ((targetMethod as { type?: string })?.type === 'terminal') {
        throw new Error(
          `Cannot pass terminal authentication method '${methodId}' to authenticate. Terminal authentication must be run in an interactive terminal.`,
        );
      }
      await withTimeout(
        authenticateConnection(connection, methodId),
        options.timeoutMs ?? DEFAULT_PROVIDER_AUTH_TIMEOUT_MS,
        'authenticating provider',
      );
    } catch (error) {
      throw withProcessDiagnostics(error, child);
    } finally {
      options.signal?.removeEventListener('abort', abort);
      terminateChildProcess(child, this.logger);
    }
  }

  async logoutProvider(
    command: string,
    args: string[],
    env?: Record<string, string>,
  ): Promise<void> {
    const { child, connection } = createAgentConnection(
      command,
      args,
      cleanEnv(env),
      this.spawnImpl,
    );
    try {
      const initResult = await initializeAuthConnection(connection, 'agentctl-logout');
      if (!initResult.agentCapabilities?.auth?.logout) {
        throw new Error(
          'Agent does not advertise logout capability (agentCapabilities.auth.logout)',
        );
      }
      await connection.logout({});
    } finally {
      terminateChildProcess(child, this.logger);
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

  const hasModelOption = !!findAgentConfigOption(configOptions, 'model');
  const models = sessionResult.models;
  if (!hasModelOption && models?.availableModels && models.availableModels.length > 0) {
    configOptions.push({
      id: 'model',
      category: 'model',
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

  const hasModeOption = !!findAgentConfigOption(configOptions, 'mode');
  const modesRes = sessionResult.modes;
  if (!hasModeOption && modesRes?.availableModes && modesRes.availableModes.length > 0) {
    configOptions.push({
      id: 'mode',
      category: 'mode',
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
