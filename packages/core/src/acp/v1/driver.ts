import { withCustomModels } from '@agentctl/shared';
import { spawn, type ChildProcess } from 'node:child_process';
import { captureConnectionLease, type AcpConnectionLease } from '../transport/connection-lease.js';
import { cancellableCallbacks } from '../transport/session-requests.js';
import { withProcessDiagnostics } from '../transport/stderr.js';
import { guardAcpTurns } from '../transport/turn-control.js';
import { drainableCallbacks } from '../transport/update-drain.js';
import { extractConfigOptionsFromSessionResult } from './configuration.js';
import { AcpV1ProviderControls } from './control.js';
import { createV1Session } from './session.js';
export { extractConfigOptionsFromSessionResult } from './configuration.js';

import {
  ndJsonStream,
  type LoadSessionResponse,
  type NewSessionResponse,
  type ResumeSessionResponse,
  type Stream,
} from '@agentclientprotocol/sdk';
import { findAgentConfigOption, type AgentConfigOption } from '@agentctl/shared';
import type { AgentDiagnosticsRecorder } from '../../agent/diagnostics.js';
import { AgentAuthenticationRequiredError } from '../../agent/errors.js';
import type {
  AgentDriver,
  AgentSession,
  AgentSessionCallbacks,
  AgentSessionOptions,
} from '../../agent/types.js';
import {
  DEFAULT_AGENT_INITIALIZATION_TIMEOUT_MS,
  DEFAULT_AGENT_MODEL,
  getAgentRequestTimeoutMs,
} from '../../config/runtime-defaults.js';
import { noopLogger, type Logger } from '../../logger.js';
import { isAcpAuthenticationRequired, isAcpSessionNotFound } from '../protocol/error-classifier.js';
import { forkProviderSession } from '../protocol/session-fork.js';
import { buildBaseSessionParams } from '../protocol/session-params.js';
import { TerminalManager } from '../protocol/terminal-manager.js';
import {
  bindSessionProcessEvents,
  ProcessStreamTransport,
  spawnManagedProcess,
} from '../transport/acp-process-lifecycle.js';
import {
  AGENTCTL_CLIENT_CAPABILITIES,
  initializeAcpConnection,
  parseAcpCapabilities,
  withTimeout,
} from './capabilities.js';
import { connectAcpClient, type AcpAgentConnection } from '../transport/client-connection.js';
import { formatAcpMessageLog, wrapDebug } from '../transport/stream-debug.js';
import type { AgentStreamTransport, CacheStorage, IConnectionManager } from '../types.js';

export class AcpV1AgentDriver implements AgentDriver {
  private connectionManager?: IConnectionManager;
  private readonly controls: AcpV1ProviderControls;

  constructor(
    private spawnImpl: typeof spawn = spawn,
    private logger: Logger = noopLogger,
    private createTransport: (child: ChildProcess, logger: Logger) => AgentStreamTransport = (
      child,
      logger,
    ) => new ProcessStreamTransport(child, logger),
    cache?: CacheStorage,
    private diagnostics?: AgentDiagnosticsRecorder,
  ) {
    this.controls = new AcpV1ProviderControls(spawnImpl, logger, createTransport, cache);
  }

  setConnectionManager(manager: IConnectionManager): void {
    this.connectionManager = manager;
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
    let lease: AcpConnectionLease | undefined;
    let providerId = '';
    let legacyModelSelection = false;
    let acpSessionId: string | null =
      options.intent.kind === 'resume' ? options.intent.sessionId : null;
    const terminalCallbacks = new Map<string, AgentSessionCallbacks>();

    if (this.connectionManager) {
      providerId =
        options.providerId ?? this.connectionManager.getProviderIdByCommand(command) ?? command;
      try {
        const persistentConn = await this.connectionManager.getConnection(providerId, {
          mcpGateway: options.mcpGateway,
        });
        lease = captureConnectionLease(persistentConn);
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

    const handle = createV1Session({
      options,
      child,
      connection,
      transport,
      capabilities: () => capabilities,
      legacyModelSelection: () => legacyModelSelection,
      processEvents,
      requests,
      updates,
      terminalManager,
      isPersistent,
      providerId,
      manager: this.connectionManager,
      lease,
    });
    void handle.closed?.finally(() => processEvents.dispose()).catch(() => undefined);

    try {
      if (isPersistent && self.connectionManager) {
        capabilities = lease!.capabilities;
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
              lease!,
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
                self.connectionManager.unregisterActiveSession?.(acpSessionId, providerId, lease!);
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
                  lease!,
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
              lease!,
            );
          }
        }
      } catch (err: unknown) {
        if (isPersistent && acpSessionId && self.connectionManager) {
          self.connectionManager.unregisterActiveSession?.(acpSessionId, providerId, lease!);
        }
        const error = err as { code?: string; data?: { configOptions?: AgentConfigOption[] } };
        if (isAcpAuthenticationRequired(error)) {
          throw new AgentAuthenticationRequiredError(handle, error.data?.configOptions ?? []);
        }
        throw err;
      }

      handle.id = acpSessionId;
      await connection.flushPendingSessionUpdates?.(handle.id ?? undefined);
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
          lease!,
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

  inspectProvider: NonNullable<AgentDriver['inspectProvider']> = (...args) =>
    this.controls.inspectProvider(...args);

  listSessions: NonNullable<AgentDriver['listSessions']> = (...args) =>
    this.controls.listSessions(...args);

  deleteSession: NonNullable<AgentDriver['deleteSession']> = (...args) =>
    this.controls.deleteSession(...args);

  invalidateProviderCache: NonNullable<AgentDriver['invalidateProviderCache']> = (...args) =>
    this.controls.invalidateProviderCache(...args);

  authenticateProvider: NonNullable<AgentDriver['authenticateProvider']> = (...args) =>
    this.controls.authenticateProvider(...args);

  logoutProvider: NonNullable<AgentDriver['logoutProvider']> = (...args) =>
    this.controls.logoutProvider(...args);

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
