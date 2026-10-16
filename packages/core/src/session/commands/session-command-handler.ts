import { eq } from 'drizzle-orm';
import type { SessionRuntime } from '../runtime/session-runtime.js';
import { sessions } from '../../db/schema.js';
import { jsonCodecs } from '../../db/json-codecs.js';
import {
  findAgentConfigOption,
  isThinkingEffort,
  resolveThinkingEffort,
  type ThinkingEffort,
} from '@agentctl/shared';
import { negotiateCapabilities } from '../../providers/capabilities-negotiator.js';
import { buildConversationHistoryTranscript } from '../history-transcript.js';
import { getContextTurnLimit } from '../../config/runtime-defaults.js';
import { resolveAgentSessionId } from '../agent-session-id.js';
import type { DbClient } from '../../db/index.js';
import type { Logger } from '../../logger.js';
import type { ProviderRegistry } from '../../providers/provider-registry.js';
import type { SessionEventRepository } from '../persistence/session-event-repository.js';
import type { SessionRuntimeRegistry } from '../runtime/session-runtime-registry.js';
import type { SessionLauncher } from '../services/session-launcher.js';
import type { SessionLifecycleService } from '../services/session-lifecycle-service.js';
import type { SessionHistoryService } from '../services/session-history-service.js';

export interface SessionCommandHandlerDependencies {
  db: DbClient;
  logger: Logger;
  providerRegistry: Pick<ProviderRegistry, 'ensureProviderReady'>;
  eventRepository: Pick<SessionEventRepository, 'append'>;
  runtimeRegistry: Pick<SessionRuntimeRegistry, 'getSession' | 'stopSessionAndWait'>;
  launcher: Pick<
    SessionLauncher,
    'buildInitialConfigOptions' | 'ensureWorkspaceAvailable' | 'reportModelFallback'
  >;
  restartSession: SessionLauncher['restartSession'];
  getOrResuscitate: SessionLauncher['getOrResuscitate'];
  switchMode: SessionLifecycleService['switchMode'];
  rewindSession: SessionHistoryService['rewindSession'];
  clearRewindBackup: SessionHistoryService['clearRewindBackup'];
}

export class SessionCommandHandler {
  constructor(private readonly deps: SessionCommandHandlerDependencies) {}

  writeTerminalInput(sessionId: string, terminalId: string, data: string): boolean {
    const session = this.deps.runtimeRegistry.getSession(sessionId);
    if (!session) {
      this.deps.logger.error(`Session not found for writeTerminalInput: ${sessionId}`);
      throw new Error(`Session not found: ${sessionId}`);
    }
    this.deps.logger.info(
      `SessionCommandHandler writing terminal input: terminalId=${terminalId}, dataLength=${String(data.length)}`,
    );
    return session.writeTerminalInput(terminalId, data);
  }

  async updateSessionConfig(
    sessionId: string,
    params: {
      selectedProvider: string;
      selectedModel: string;
      selectedThinkingEffort?: ThinkingEffort;
    },
    options: { forceNewAgentSession?: boolean } = {},
  ): Promise<SessionRuntime | null> {
    const sessionRecord = await this.deps.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });

    if (!sessionRecord) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const provider = await this.deps.providerRegistry.ensureProviderReady(params.selectedProvider, {
      force: false,
    });
    if (!provider.isReady && !provider.needsAuth) {
      throw new Error(`Selected agent is not ready: ${params.selectedProvider}`);
    }

    const selection = negotiateCapabilities(
      provider,
      params.selectedModel,
      params.selectedThinkingEffort === undefined &&
        sessionRecord.selectedProvider === params.selectedProvider
        ? sessionRecord.selectedThinkingEffort
        : params.selectedThinkingEffort,
    );
    if (!selection.selectedModel.trim()) {
      throw new Error(`Provider ${params.selectedProvider} did not negotiate a model`);
    }

    const discovery = provider.toDiscovery();
    const configOptions = discovery.configOptions ?? [];
    const newConfigOptions = this.deps.launcher.buildInitialConfigOptions(
      configOptions,
      selection.selectedModel,
      selection.selectedThinkingEffort,
    );
    const providerIdChanged = sessionRecord.selectedProvider !== params.selectedProvider;
    const modelChanged = selection.selectedModel !== sessionRecord.selectedModel;
    const effortChanged = selection.selectedThinkingEffort !== sessionRecord.selectedThinkingEffort;
    await this.deps.launcher.ensureWorkspaceAvailable(sessionId);
    const activeSession = this.deps.runtimeRegistry.getSession(sessionId);

    const persistSelection = async (preserveLiveOptions = false): Promise<void> => {
      let preservedLimit = sessionRecord.contextLimit > 0 ? sessionRecord.contextLimit : 0;
      if (preservedLimit === 0 && sessionRecord.sessionMetrics) {
        const metrics = jsonCodecs.unknownRecord(sessionRecord.sessionMetrics);
        if (typeof metrics.contextLimit === 'number' && metrics.contextLimit > 0) {
          preservedLimit = metrics.contextLimit;
        }
      }

      await this.deps.db
        .update(sessions)
        .set({
          selectedProvider: params.selectedProvider,
          selectedModel: selection.selectedModel,
          selectedThinkingEffort: selection.selectedThinkingEffort,
          contextLimit: preservedLimit,
          availableCommands: '[]',
          ...(preserveLiveOptions
            ? {}
            : { sessionConfigOptions: JSON.stringify(newConfigOptions) }),
          ...(providerIdChanged
            ? {
                agentPersona: null,
                availableAgentPersonas: JSON.stringify([
                  ...new Set([
                    ...(discovery.modes ?? []),
                    ...configOptions
                      .filter((option) => option.category === 'mode')
                      .flatMap((option) => option.options?.map((item) => item.value) ?? []),
                  ]),
                ]),
              }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(sessions.id, sessionId));
    };

    const rollbackSelection = async (): Promise<void> => {
      await this.deps.db
        .update(sessions)
        .set({
          selectedProvider: sessionRecord.selectedProvider,
          selectedModel: sessionRecord.selectedModel,
          selectedThinkingEffort: sessionRecord.selectedThinkingEffort,
          agent: sessionRecord.agent,
          agentPersona: sessionRecord.agentPersona,
          availableAgentPersonas: sessionRecord.availableAgentPersonas,
          contextLimit: sessionRecord.contextLimit,
          availableCommands: sessionRecord.availableCommands,
          sessionConfigOptions: sessionRecord.sessionConfigOptions,
          updatedAt: sessionRecord.updatedAt,
        })
        .where(eq(sessions.id, sessionId));
    };

    if (
      activeSession &&
      !activeSession.isDead &&
      !providerIdChanged &&
      !options.forceNewAgentSession
    ) {
      const needsModelRestart = modelChanged && !selection.features.configuration.model;
      const needsEffortRestart = effortChanged && !selection.features.configuration.options;

      if (!needsModelRestart && !needsEffortRestart) {
        let liveConfigOptions =
          jsonCodecs.agentConfigOptionsOrNull(sessionRecord.sessionConfigOptions) ?? configOptions;
        let thinkingOption: (typeof configOptions)[number] | undefined;
        let modelWasUpdated = false;
        let effortWasUpdated = false;
        try {
          if (modelChanged) {
            const liveOptions = await activeSession.updateModel(selection.selectedModel);
            modelWasUpdated = true;
            if (Array.isArray(liveOptions)) liveConfigOptions = liveOptions;
            else {
              const refreshed = await this.deps.db.query.sessions.findFirst({
                where: eq(sessions.id, sessionId),
              });
              liveConfigOptions =
                jsonCodecs.agentConfigOptionsOrNull(refreshed?.sessionConfigOptions) ?? [];
            }
          }
          // A model switch can replace both the effort IDs and the default. Negotiate
          // against that live snapshot, preserving the old choice only on the same model.
          thinkingOption = findAgentConfigOption(liveConfigOptions, 'thought_level');
          selection.selectedThinkingEffort = resolveThinkingEffort(
            thinkingOption,
            params.selectedThinkingEffort === undefined && !modelChanged
              ? sessionRecord.selectedThinkingEffort
              : params.selectedThinkingEffort,
            discovery.defaultThinkingEffort,
          );
          if (
            thinkingOption &&
            selection.selectedThinkingEffort !== null &&
            selection.selectedThinkingEffort !== thinkingOption.currentValue
          ) {
            const updated = await activeSession.updateConfigOption(
              thinkingOption.id,
              selection.selectedThinkingEffort,
            );
            effortWasUpdated = true;
            if (Array.isArray(updated)) {
              const effective = findAgentConfigOption(updated, 'thought_level')?.currentValue;
              selection.selectedThinkingEffort = isThinkingEffort(effective) ? effective : null;
            }
          }
          // SessionRuntime persists live option updates; keep them when saving legacy selections.
          await persistSelection(true);
          await this.deps.launcher.reportModelFallback(sessionId, selection);
          return activeSession;
        } catch (error) {
          if (modelWasUpdated) {
            await activeSession.updateModel(sessionRecord.selectedModel).catch(() => undefined);
          }
          const originalThinking = findAgentConfigOption(
            jsonCodecs.agentConfigOptionsOrNull(sessionRecord.sessionConfigOptions) ?? [],
            'thought_level',
          );
          if (
            (effortWasUpdated || modelWasUpdated) &&
            originalThinking &&
            sessionRecord.selectedThinkingEffort !== null
          ) {
            await activeSession
              .updateConfigOption(originalThinking.id, sessionRecord.selectedThinkingEffort)
              .catch(() => undefined);
          }
          await rollbackSelection();
          throw error;
        }
      }
    }

    if (options.forceNewAgentSession) {
      await this.deps.runtimeRegistry.stopSessionAndWait(sessionId);
    }

    try {
      await persistSelection();
      await this.deps.launcher.reportModelFallback(sessionId, selection);
      return options.forceNewAgentSession
        ? await this.deps.restartSession(sessionId, { resumeExisting: false })
        : await this.deps.restartSession(sessionId);
    } catch (error) {
      await rollbackSelection();
      if (options.forceNewAgentSession && providerIdChanged) {
        await this.deps.restartSession(sessionId).catch((rollbackError: unknown) => {
          this.deps.logger.error(
            rollbackError,
            'Failed to restore source provider after target provider startup failed',
          );
        });
      }
      throw error;
    }
  }

  async setConfigOption(
    sessionId: string,
    configId: string,
    value: string | boolean,
  ): Promise<void> {
    const session = this.deps.runtimeRegistry.getSession(sessionId);
    if (!session || session.isDead) {
      throw new Error(`Session is not active: ${sessionId}`);
    }

    const sessionRecord = await this.deps.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });
    if (!sessionRecord) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const advertisedOptions = jsonCodecs.agentConfigOptionsOrNull(
      sessionRecord.sessionConfigOptions,
    );
    if (!advertisedOptions) {
      throw new Error(`Session ${sessionId} has invalid advertised config options`);
    }
    const option = advertisedOptions.find((candidate) => candidate.id === configId);
    if (!option) {
      throw new Error(`Config option is not advertised for this session: ${configId}`);
    }
    if (typeof value === 'boolean') {
      if (option.type !== 'boolean') {
        throw new Error(`Config option ${configId} does not support boolean values`);
      }
    } else {
      if (!option.options?.some((candidate: { value: string }) => candidate.value === value)) {
        throw new Error(`Invalid value for config option ${configId}: ${value}`);
      }
    }

    const provider = await this.deps.providerRegistry.ensureProviderReady(
      sessionRecord.selectedProvider,
      { force: false },
    );
    if (!provider.isReady && !provider.needsAuth) {
      throw new Error(`Selected agent is not ready: ${sessionRecord.selectedProvider}`);
    }

    const isModelOption = option === findAgentConfigOption(advertisedOptions, 'model');
    if (isModelOption && !provider.features.configuration.model) {
      throw new Error(`Provider does not support dynamic config option: ${configId}`);
    }

    await session.updateConfigOption(configId, value);
  }

  async setAgentPersona(sessionId: string, persona: string) {
    const sessionRecord = await this.deps.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });
    if (!sessionRecord) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const availablePersonas = jsonCodecs.stringArray(sessionRecord.availableAgentPersonas);
    if (!availablePersonas.includes(persona)) {
      throw new Error(`Agent persona is not available for this session: ${persona}`);
    }

    const session = this.deps.runtimeRegistry.getSession(sessionId);
    if (session && !session.isDead) {
      await session.setMode(persona);
    }

    await this.deps.db
      .update(sessions)
      .set({
        agentPersona: persona,
        updatedAt: new Date(),
      })
      .where(eq(sessions.id, sessionId));
  }

  async updateApprovalMode(sessionId: string, approvalMode: string) {
    const validMode = (
      ['review', 'auto_approve', 'yolo'].includes(approvalMode) ? approvalMode : 'review'
    ) as 'review' | 'auto_approve' | 'yolo';

    await this.deps.db
      .update(sessions)
      .set({
        approvalMode: validMode,
        updatedAt: new Date(),
      })
      .where(eq(sessions.id, sessionId));
  }

  async handleClientMessage(
    sessionId: string,
    action:
      | 'approve'
      | 'deny'
      | 'cancel'
      | 'set_mode'
      | 'set_persona'
      | 'session.input'
      | 'set_config_option'
      | 'session.rewind',
    payload: {
      eventId?: string | number;
      optionId?: string;
      input?: string;
      attachmentIds?: string[];
      mode?: string;
      persona?: string;
      configId?: string;
      value?: string;
      onAccepted?: (eventId: number) => void;
      clientMessageId?: string;
      acceptedEventId?: number;
      attemptId?: string;
    },
  ) {
    const session = ['approve', 'deny', 'cancel'].includes(action)
      ? this.deps.runtimeRegistry.getSession(sessionId)
      : await this.deps.getOrResuscitate(sessionId, { allowArchived: true });

    if (!session) {
      this.deps.logger.warn(
        { sessionId },
        'Received message for unknown or non-resuscitatable session',
      );
      if (action === 'session.input') throw new Error('Session is unavailable');
      return;
    }

    if (action === 'approve') {
      session.resolvePermission(String(payload.eventId), {
        allowed: true,
        optionId: payload.optionId,
      });
    } else if (action === 'deny') {
      session.resolvePermission(String(payload.eventId), {
        allowed: false,
      });
    } else if (action === 'cancel') {
      await session.cancel();
    } else if (action === 'set_mode') {
      if (payload.mode) {
        if (payload.mode === 'local' || payload.mode === 'worktree') {
          await this.deps.switchMode(sessionId, payload.mode);
        } else {
          await this.updateApprovalMode(sessionId, payload.mode);
        }
      }
    } else if (action === 'set_persona') {
      if (payload.persona) {
        await this.setAgentPersona(sessionId, payload.persona);
      }
    } else if (action === 'set_config_option') {
      if (payload.configId && payload.value !== undefined) {
        await this.setConfigOption(sessionId, payload.configId, payload.value);
      }
    } else if (action === 'session.rewind') {
      const rewindMode = (payload.mode ?? 'conversation') as 'conversation' | 'files' | 'fork';
      const evtId = Number(payload.eventId);
      if (!evtId) {
        this.deps.logger.warn({ sessionId }, 'Rewind called without eventId');
        return;
      }
      await this.deps.rewindSession(sessionId, evtId, rewindMode);
    } else if (payload.input !== undefined) {
      let historyContext: string | undefined;

      const sessionRecord = await this.deps.db.query.sessions.findFirst({
        where: eq(sessions.id, sessionId),
      });

      if (sessionRecord) {
        const existingAgentSessionId = resolveAgentSessionId(
          sessionRecord.agentSessionId,
          sessionRecord.selectedProvider,
          sessionRecord.agent,
        );
        const hasExistingProviderSession =
          Boolean(existingAgentSessionId) && !session.requiresHistoryContext;

        if (!hasExistingProviderSession) {
          const transcript = await buildConversationHistoryTranscript(this.deps.db, sessionId, {
            maxTurns: getContextTurnLimit(),
            beforeEventId: payload.acceptedEventId,
            contextWindow: sessionRecord.contextLimit,
          });
          if (transcript) {
            historyContext = transcript;
            await this.deps.eventRepository.append(
              sessionId,
              'status',
              {
                status: 'context_handoff',
                title: `Transferred recent conversation context to ${sessionRecord.selectedProvider}`,
              },
              null,
            );
          }
        }
      }

      if (payload.attemptId) await session.bindAttempt(payload.attemptId);
      this.deps.clearRewindBackup(sessionId);
      if (payload.onAccepted || payload.acceptedEventId) {
        await session.prompt(
          payload.input,
          payload.attachmentIds,
          historyContext,
          undefined,
          payload.onAccepted,
          payload.clientMessageId,
          payload.acceptedEventId && payload.attemptId
            ? { eventId: payload.acceptedEventId, attemptId: payload.attemptId }
            : undefined,
        );
      } else {
        await session.prompt(payload.input, payload.attachmentIds, historyContext);
      }
      session.markHistoryContextTransferred?.();
    }
  }
}
