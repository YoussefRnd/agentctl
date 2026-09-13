import { spawn } from 'node:child_process';
import { eq, asc, desc, inArray, and } from 'drizzle-orm';
import type { ACPSession } from '../acp/session-client.js';
import type { DbClient } from '../db/index.js';
import type { AgentDriver, AgentSessionIntent } from '../agent/types.js';
import { AcpAgentDriver } from '../acp/driver.js';
import type { Logger } from '../logger.js';
import { noopLogger } from '../logger.js';
import { SessionEventStore } from './event-store.js';
import { sessions, projects, acpEvents } from '../db/schema.js';
import type { WorkspaceManager } from '../git/worktree-manager.js';
import { SessionWorkspace } from '../git/session-workspace.js';
import { negotiateCapabilities } from '../acp/transport/capabilities-negotiator.js';
import type { ProviderRegistry } from '../providers/provider-registry.js';
import {
  type ACPConfigOption,
  type SessionMode,
  type ThinkingEffort,
  type ACPEvent,
} from '@agentctl/shared';
import { SessionStateMachine } from './state-machine.js';
import type { McpGateway } from '../mcp/mcp-gateway.js';
import { buildConversationHistoryTranscript } from './history-transcript.js';
import {
  findAgentGeneratedHandoff,
  generateHandoffDocument,
  scheduleHandoffCleanup,
  type HandoffResult,
} from './handoff.js';
import type { ACPEventDbRow } from '../db/zod-schemas.js';
import {
  DEFAULT_AGENT_MODEL,
  DEFAULT_THINKING_EFFORT,
  getContextTurnLimit,
} from '../config/runtime-defaults.js';

export interface IEventBus {
  publish(event: unknown): void;
}

export interface CreateSessionParams {
  projectId: string;
  providerId?: string;
  taskSlug: string;
  mode?: SessionMode;
  selectedModel?: string;
  selectedThinkingEffort?: ThinkingEffort;
}

export function resolveAgentSessionId(
  rawAgentSessionId: string | null | undefined,
  targetProviderId: string,
  initialProviderId?: string | null,
): string | null {
  if (!rawAgentSessionId) return null;
  try {
    const parsed = JSON.parse(rawAgentSessionId) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const val = (parsed as Record<string, unknown>)[targetProviderId];
      return typeof val === 'string' ? val : null;
    }
  } catch {
    if (!initialProviderId || initialProviderId === targetProviderId) {
      return rawAgentSessionId;
    }
  }
  return null;
}

export class SessionManager {
  private eventStore: SessionEventStore;
  private stateMachine: SessionStateMachine;
  private sessionWorkspace: SessionWorkspace;
  private rewindBackups = new Map<
    string,
    {
      undoSnapshotHash?: string;
      deletedEvents: ACPEventDbRow[];
      eventId: number;
      restoredFiles?: Array<{
        path: string;
        status: 'added' | 'modified' | 'deleted';
        additions?: number;
        deletions?: number;
      }>;
    }
  >();

  constructor(
    private db: DbClient,
    private workspaceManager: WorkspaceManager,
    private providerRegistry: ProviderRegistry,
    eventBus: IEventBus,
    private logger: Logger = noopLogger,
    private runtime: AgentDriver = AcpAgentDriver.create(spawn, logger),
    private mcpGateway?: McpGateway,
  ) {
    if (this.runtime instanceof AcpAgentDriver) {
      this.runtime.setConnectionManager(this.providerRegistry.getConnectionManager());
    }
    this.eventStore = new SessionEventStore(db, eventBus);
    this.stateMachine = new SessionStateMachine(
      db,
      workspaceManager,
      providerRegistry,
      this.eventStore,
      logger,
      runtime,
      mcpGateway,
    );
    this.sessionWorkspace = new SessionWorkspace(
      db,
      workspaceManager,
      (sessionId) => {
        this.stateMachine.stopSession(sessionId);
      },
      () => this.stateMachine.getSnapshotService(),
      (event, payload) => {
        this.logger.info({ event, ...payload }, `Git Workspace Event: ${event}`);
        eventBus.publish({ type: event, ...payload });
      },
    );
  }

  async syncOrphans(): Promise<void> {
    const activeSessions = await this.db.query.sessions.findMany({
      where: inArray(sessions.status, ['idle', 'running', 'needs_attention', 'error']),
    });
    const activeIds = activeSessions.map((s) => s.id);
    await this.sessionWorkspace.syncOrphans(activeIds);
  }

  writeTerminalInput(sessionId: string, terminalId: string, data: string): boolean {
    const session = this.stateMachine.getSession(sessionId);
    if (!session) {
      this.logger.error(`Session not found for writeTerminalInput: ${sessionId}`);
      throw new Error(`Session not found: ${sessionId}`);
    }
    this.logger.info(
      `SessionManager writing terminal input: terminalId=${terminalId}, dataLength=${String(data.length)}`,
    );
    return session.writeTerminalInput(terminalId, data);
  }

  private async resolveSessionProviderAndParameters(
    projectId: string,
    requestedProviderId?: string,
    requestedModel?: string,
    requestedThinkingEffort?: ThinkingEffort,
  ): Promise<{
    providerId: string;
    selection: ReturnType<typeof negotiateCapabilities>;
    configOptions: ReturnType<SessionManager['buildInitialConfigOptions']>;
  }> {
    // 1. Explicit provider requested by caller
    if (requestedProviderId) {
      const { selection, configOptions } = await this.resolveLaunchParameters(
        requestedProviderId,
        requestedModel,
        requestedThinkingEffort,
      );
      return {
        providerId: requestedProviderId,
        selection,
        configOptions,
      };
    }

    // 2. Inherit from project's most recent session
    try {
      const lastSession = await this.db.query.sessions.findFirst({
        where: eq(sessions.projectId, projectId),
        orderBy: [desc(sessions.createdAt)],
      });

      if (lastSession?.selectedProvider) {
        try {
          const inheritedModel = requestedModel ?? lastSession.selectedModel ?? undefined;
          const inheritedEffort =
            requestedThinkingEffort ??
            (lastSession.selectedThinkingEffort as ThinkingEffort | undefined);

          const { selection, configOptions } = await this.resolveLaunchParameters(
            lastSession.selectedProvider,
            inheritedModel,
            inheritedEffort,
          );
          return {
            providerId: lastSession.selectedProvider,
            selection,
            configOptions,
          };
        } catch (err) {
          this.logger.warn(
            { err, providerId: lastSession.selectedProvider, projectId },
            'Failed to inherit last-used provider from project; falling back',
          );
        }
      }
    } catch (err) {
      this.logger.warn({ err, projectId }, 'Failed to query project sessions for inheritance');
    }

    // 3. Fallback to global defaultProviderId setting
    const settings = await this.providerRegistry.getSettings();
    const defaultProviderId = settings.defaultProviderId;
    if (defaultProviderId) {
      try {
        const { selection, configOptions } = await this.resolveLaunchParameters(
          defaultProviderId,
          requestedModel,
          requestedThinkingEffort,
        );
        return {
          providerId: defaultProviderId,
          selection,
          configOptions,
        };
      } catch (err) {
        this.logger.warn(
          { err, providerId: defaultProviderId },
          'Configured default provider is not ready; falling back to discoverable providers',
        );
      }
    }

    // 4. Fallback to the first discoverable/ready provider in the registry
    try {
      if (typeof this.providerRegistry.discover === 'function') {
        const discoverable = await this.providerRegistry.discover();
        for (const candidate of discoverable) {
          if (candidate.id === defaultProviderId) continue;
          try {
            const { selection, configOptions } = await this.resolveLaunchParameters(
              candidate.id,
              requestedModel,
              requestedThinkingEffort,
            );
            return {
              providerId: candidate.id,
              selection,
              configOptions,
            };
          } catch {
            // Candidate not ready, try next
          }
        }
      }
    } catch (err) {
      this.logger.warn({ err }, 'Failed to discover fallback providers');
    }

    throw new Error(
      'No agent provider is available or ready. Please configure or install an agent provider in settings.',
    );
  }

  async createSession(params: CreateSessionParams): Promise<{ sessionId: string }> {
    const { projectId, providerId, taskSlug, mode, selectedModel, selectedThinkingEffort } = params;

    const {
      providerId: resolvedProviderId,
      selection,
      configOptions,
    } = await this.resolveSessionProviderAndParameters(
      projectId,
      providerId,
      selectedModel,
      selectedThinkingEffort,
    );

    const context = await this.sessionWorkspace.establish(projectId, taskSlug, {
      mode,
      agent: resolvedProviderId,
      selectedProvider: resolvedProviderId,
      selectedModel: selection.selectedModel,
      selectedThinkingEffort: selection.selectedThinkingEffort,
      contextLimit: 0,
      sessionConfigOptions: JSON.stringify(configOptions),
    });

    return { sessionId: context.sessionId };
  }

  async startSession(
    sessionId: string,
    worktreePath: string,
    command: string,
    args: string[],
    env?: Record<string, string>,
    selectedModel = DEFAULT_AGENT_MODEL,
    selectedThinkingEffort: ThinkingEffort = DEFAULT_THINKING_EFFORT,
    supportsDynamicModel = false,
    supportsDynamicConfig = false,
    resolvedThinkingConfigId?: string,
    intent: AgentSessionIntent = { kind: 'new' },
    resolvedModelConfigId?: string,
  ): Promise<ACPSession> {
    return this.stateMachine.startSession(
      sessionId,
      worktreePath,
      command,
      args,
      env,
      selectedModel,
      selectedThinkingEffort,
      supportsDynamicModel,
      supportsDynamicConfig,
      resolvedThinkingConfigId,
      intent,
      resolvedModelConfigId,
    );
  }

  async restartSession(
    sessionId: string,
    options: { resumeExisting?: boolean } = {},
  ): Promise<ACPSession> {
    this.logger.info({ sessionId }, 'Restarting session');
    this.stateMachine.stopSession(sessionId);

    await this.db.update(sessions).set({ updatedAt: new Date() }).where(eq(sessions.id, sessionId));

    const sessionRecord = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });

    if (!sessionRecord) {
      throw new Error(`Session or associated project not found: ${sessionId}`);
    }

    const { launch, selection, configOptions } = await this.resolveLaunchParameters(
      sessionRecord.selectedProvider,
      sessionRecord.selectedModel,
      sessionRecord.selectedThinkingEffort as ThinkingEffort,
    );

    await this.db
      .update(sessions)
      .set({
        sessionConfigOptions: JSON.stringify(configOptions),
        updatedAt: new Date(),
      })
      .where(eq(sessions.id, sessionId));

    let workspacePath =
      sessionRecord.mode === 'worktree' ? sessionRecord.worktreePath : sessionRecord.project.path;

    if (sessionRecord.status === 'archived') {
      const context = await this.sessionWorkspace.activate(sessionId, {
        baseBranch: sessionRecord.baseBranch ?? 'main',
      });
      workspacePath = context.worktreePath;
    }

    let hasUserMessages = false;
    if (options.resumeExisting !== false) {
      const messages = await this.db
        .select({ id: acpEvents.id })
        .from(acpEvents)
        .where(and(eq(acpEvents.sessionId, sessionId), eq(acpEvents.type, 'text')));
      hasUserMessages = messages.length > 0;
    }

    const resolvedAgentSessionId =
      hasUserMessages && options.resumeExisting !== false
        ? resolveAgentSessionId(
            sessionRecord.agentSessionId,
            sessionRecord.selectedProvider,
            sessionRecord.agent,
          )
        : null;

    return this.startSession(
      sessionId,
      workspacePath,
      launch.command,
      launch.args,
      launch.env,
      selection.selectedModel,
      selection.selectedThinkingEffort,
      selection.supportsDynamicModel,
      selection.supportsDynamicConfig,
      selection.resolvedThinkingConfigId,
      resolvedAgentSessionId
        ? { kind: 'resume', sessionId: resolvedAgentSessionId }
        : { kind: 'new' },
      selection.resolvedModelConfigId,
    );
  }

  private async createForkSession(
    sourceRecord: {
      id: string;
      projectId: string;
      taskSlug: string;
      mode: string;
      selectedProvider: string;
      selectedModel: string;
      selectedThinkingEffort: string;
      contextLimit: number;
      project: { path: string; repoRoot: string | null; subdir: string };
    },
    eventsToCopy: {
      type: string;
      data: unknown;
      parentEventId: number | null;
      metadata: string | null;
    }[],
    forkFromAgentSessionId?: string,
  ): Promise<string> {
    const context = await this.sessionWorkspace.establish(
      sourceRecord.projectId,
      `${sourceRecord.taskSlug}-fork`,
      {
        mode: sourceRecord.mode as SessionMode,
        agent: sourceRecord.selectedProvider,
        selectedProvider: sourceRecord.selectedProvider,
        selectedModel: sourceRecord.selectedModel,
        selectedThinkingEffort: sourceRecord.selectedThinkingEffort,
        contextLimit: sourceRecord.contextLimit > 0 ? sourceRecord.contextLimit : 0,
        title: `${sourceRecord.taskSlug}-fork`,
      },
    );

    const forkSessionId = context.sessionId;
    const worktreePath = context.worktreePath;

    for (const evt of eventsToCopy) {
      let parsedData: unknown = evt.data;
      if (typeof evt.data === 'string') {
        try {
          parsedData = JSON.parse(evt.data);
        } catch {
          parsedData = evt.data;
        }
      }
      let parsedMetadata: unknown = evt.metadata;
      if (typeof evt.metadata === 'string') {
        try {
          parsedMetadata = JSON.parse(evt.metadata);
        } catch {
          parsedMetadata = evt.metadata;
        }
      }
      await this.eventStore.append(
        forkSessionId,
        evt.type as ACPEvent['type'],
        parsedData,
        evt.parentEventId,
        parsedMetadata ?? undefined,
      );
    }

    const { launch, selection } = await this.resolveLaunchParameters(
      sourceRecord.selectedProvider,
      sourceRecord.selectedModel,
      sourceRecord.selectedThinkingEffort as ThinkingEffort,
    );

    try {
      await this.startSession(
        forkSessionId,
        worktreePath,
        launch.command,
        launch.args,
        launch.env,
        selection.selectedModel,
        selection.selectedThinkingEffort,
        selection.supportsDynamicModel,
        selection.supportsDynamicConfig,
        selection.resolvedThinkingConfigId,
        forkFromAgentSessionId
          ? { kind: 'fork', sessionId: forkFromAgentSessionId }
          : { kind: 'new' },
        selection.resolvedModelConfigId,
      );
    } catch (error) {
      await this.db
        .update(sessions)
        .set({ status: 'error', updatedAt: new Date() })
        .where(eq(sessions.id, forkSessionId));
      await this.eventStore.append(forkSessionId, 'status', {
        status: 'error',
        title: error instanceof Error ? error.message : 'Failed to start forked session',
      });
      throw error;
    }

    return forkSessionId;
  }

  async handoffSession(
    sessionId: string,
    targetProvider: string,
    targetModel?: string,
    nextSessionFocus?: string,
  ): Promise<{
    sessionId: string;
    handoffFilePath: string;
    initialPrompt: string;
    handoffSource: HandoffResult['source'];
  }> {
    const sessionRecord = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });

    if (!sessionRecord) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    if (sessionRecord.status === 'running') {
      throw new Error('Wait for the current agent turn to finish before switching providers');
    }
    if (sessionRecord.selectedProvider === targetProvider) {
      throw new Error(`Session is already using provider: ${targetProvider}`);
    }

    const { providerId: resolvedProviderId, selection } =
      await this.resolveSessionProviderAndParameters(
        sessionRecord.projectId,
        targetProvider,
        targetModel,
        sessionRecord.selectedThinkingEffort as ThinkingEffort,
      );

    const latestEventRows = await this.db
      .select({ id: acpEvents.id })
      .from(acpEvents)
      .where(eq(acpEvents.sessionId, sessionId))
      .orderBy(desc(acpEvents.id))
      .limit(1);
    const latestEventId = latestEventRows[0]?.id ?? 0;

    let handoffResult: HandoffResult | null = null;
    try {
      const sourceSession =
        this.stateMachine.getSession(sessionId) ?? (await this.restartSession(sessionId));
      const focusParts = [`Continue this work with ${resolvedProviderId}.`];
      if (nextSessionFocus?.trim()) {
        focusParts.push(nextSessionFocus.trim());
      }
      await sourceSession.prompt(focusParts.join(' '), undefined, undefined, {
        purpose: 'provider-handoff',
      });
      await sourceSession.flushAll();

      const generatedEvents = await this.db
        .select()
        .from(acpEvents)
        .where(eq(acpEvents.sessionId, sessionId))
        .orderBy(desc(acpEvents.id));
      const responseTexts = generatedEvents
        .filter((event) => event.id > latestEventId && event.type === 'text')
        .map((event) => {
          try {
            const data = JSON.parse(event.data) as {
              role?: string;
              content?: string;
              text?: string;
            };
            return data.role === 'provider' ? (data.content ?? data.text ?? '') : '';
          } catch {
            return '';
          }
        })
        .filter((text) => text.length > 0);
      handoffResult = await findAgentGeneratedHandoff(responseTexts, sessionId);
    } catch (error) {
      this.logger.warn(error, 'The source agent could not produce a handoff document');
    }

    handoffResult ??= await generateHandoffDocument(this.db, sessionId, resolvedProviderId, {
      nextSessionFocus,
      maxEventId: latestEventId,
    });

    const sessionBeforeSwitch = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });
    if (sessionBeforeSwitch?.status === 'running') {
      scheduleHandoffCleanup(handoffResult.filePath);
      throw new Error('The source agent started another turn before the handoff could complete');
    }

    const sourceSelection = {
      selectedProvider: sessionRecord.selectedProvider,
      selectedModel: sessionRecord.selectedModel,
      selectedThinkingEffort: sessionRecord.selectedThinkingEffort as ThinkingEffort,
    };
    const initialPrompt = `Continue the work from the attached handoff context.${
      nextSessionFocus && nextSessionFocus.trim().length > 0
        ? ` Focus for this session: ${nextSessionFocus.trim()}`
        : ''
    }`;

    try {
      const targetSession = await this.updateSessionConfig(
        sessionId,
        {
          selectedProvider: resolvedProviderId,
          selectedModel: selection.selectedModel,
          selectedThinkingEffort: selection.selectedThinkingEffort,
        },
        { forceNewAgentSession: true },
      );
      if (!targetSession) {
        throw new Error(`Failed to start target provider: ${resolvedProviderId}`);
      }

      await this.eventStore.append(
        sessionId,
        'status',
        {
          status: 'context_handoff',
          title: `Handoff from ${sessionRecord.selectedProvider} to ${resolvedProviderId}`,
          handoffFilePath: handoffResult.filePath,
          handoffSource: handoffResult.source,
        },
        null,
      );
      await targetSession.prompt(initialPrompt, undefined, handoffResult.content);
    } catch (error) {
      await this.stateMachine.stopSessionAndWait(sessionId).catch(() => undefined);
      await this.updateSessionConfig(sessionId, sourceSelection).catch((rollbackError: unknown) => {
        this.logger.error(rollbackError, 'Failed to restore source provider after handoff failed');
      });
      throw error;
    } finally {
      scheduleHandoffCleanup(handoffResult.filePath);
    }

    return {
      sessionId,
      handoffFilePath: handoffResult.filePath,
      initialPrompt,
      handoffSource: handoffResult.source,
    };
  }

  private buildInitialConfigOptions(
    providerConfigOptions: ACPConfigOption[],
    selectedModel: string,
    selectedThinkingEffort: ThinkingEffort,
  ): ACPConfigOption[] {
    return providerConfigOptions.map((opt) => {
      if (opt.id === 'model' || opt.id === 'selectedModel') {
        return { ...opt, currentValue: selectedModel };
      }
      if (
        opt.id === 'thinking' ||
        opt.id === 'thinking_effort' ||
        opt.id === 'selectedThinkingEffort'
      ) {
        return { ...opt, currentValue: selectedThinkingEffort };
      }
      return opt;
    });
  }

  private async resolveLaunchParameters(
    providerId: string,
    requestedModel?: string,
    requestedThinkingEffort?: ThinkingEffort,
  ) {
    const provider = await this.providerRegistry.ensureProviderReady(providerId, { force: false });
    if (!provider.isReady && !provider.needsAuth) {
      throw new Error(`Selected agent is not ready: ${providerId}`);
    }

    const selection = negotiateCapabilities(provider, requestedModel, requestedThinkingEffort);

    const launch = provider.getLaunchConfig(
      selection.selectedModel,
      selection.selectedThinkingEffort,
    );

    return {
      launch,
      selection,
      configOptions: this.buildInitialConfigOptions(
        provider.toDiscovery().configOptions ?? [],
        selection.selectedModel,
        selection.selectedThinkingEffort,
      ),
    };
  }

  async updateSessionConfig(
    sessionId: string,
    params: {
      selectedProvider: string;
      selectedModel: string;
      selectedThinkingEffort: ThinkingEffort;
    },
    options: { forceNewAgentSession?: boolean } = {},
  ): Promise<ACPSession | null> {
    const sessionRecord = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });

    if (!sessionRecord) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Resolve and negotiate before mutating persisted state. In particular, a
    // provider requiring authentication is not ready for a live switch.
    const provider = await this.providerRegistry.ensureProviderReady(params.selectedProvider, {
      force: false,
    });
    if (!provider.isReady && !provider.needsAuth) {
      throw new Error(`Selected agent is not ready: ${params.selectedProvider}`);
    }

    const selection = negotiateCapabilities(
      provider,
      params.selectedModel,
      params.selectedThinkingEffort,
    );
    if (!selection.selectedModel.trim()) {
      throw new Error(`Provider ${params.selectedProvider} did not negotiate a model`);
    }

    const configOptions = provider.toDiscovery().configOptions ?? [];
    const newConfigOptions = this.buildInitialConfigOptions(
      configOptions,
      selection.selectedModel,
      selection.selectedThinkingEffort,
    );
    const providerIdChanged = sessionRecord.selectedProvider !== params.selectedProvider;
    const modelChanged = selection.selectedModel !== sessionRecord.selectedModel;
    const effortChanged = selection.selectedThinkingEffort !== sessionRecord.selectedThinkingEffort;
    const activeSession = this.stateMachine.getSession(sessionId);

    const persistSelection = async (): Promise<void> => {
      let preservedLimit = sessionRecord.contextLimit > 0 ? sessionRecord.contextLimit : 0;
      if (preservedLimit === 0 && sessionRecord.sessionMetrics) {
        try {
          const metrics = JSON.parse(sessionRecord.sessionMetrics) as { contextLimit?: number };
          if (typeof metrics.contextLimit === 'number' && metrics.contextLimit > 0) {
            preservedLimit = metrics.contextLimit;
          }
        } catch {
          // ignore
        }
      }

      await this.db
        .update(sessions)
        .set({
          selectedProvider: params.selectedProvider,
          selectedModel: selection.selectedModel,
          selectedThinkingEffort: selection.selectedThinkingEffort,
          contextLimit: preservedLimit,
          availableCommands: '[]',
          sessionConfigOptions: JSON.stringify(newConfigOptions),
          updatedAt: new Date(),
        })
        .where(eq(sessions.id, sessionId));
    };

    const rollbackSelection = async (): Promise<void> => {
      await this.db
        .update(sessions)
        .set({
          selectedProvider: sessionRecord.selectedProvider,
          selectedModel: sessionRecord.selectedModel,
          selectedThinkingEffort: sessionRecord.selectedThinkingEffort,
          agent: sessionRecord.agent,
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
      const needsModelRestart = modelChanged && !selection.supportsDynamicModel;
      const needsEffortRestart = effortChanged && !selection.supportsDynamicConfig;

      if (!needsModelRestart && !needsEffortRestart) {
        const thinkingOption = configOptions.find(
          (opt: { id: string }) =>
            opt.id === 'thinking' ||
            opt.id === 'thinking_effort' ||
            opt.id === 'selectedThinkingEffort',
        );
        let modelWasUpdated = false;
        let effortWasUpdated = false;
        try {
          if (modelChanged) {
            await activeSession.updateModel(selection.selectedModel);
            modelWasUpdated = true;
          }
          if (effortChanged) {
            if (!thinkingOption) {
              throw new Error('Provider did not advertise a thinking-effort option');
            }
            await activeSession.updateConfigOption(
              thinkingOption.id,
              selection.selectedThinkingEffort,
            );
            effortWasUpdated = true;
          }
          await persistSelection();
          return activeSession;
        } catch (error) {
          // Best-effort runtime rollback; persisted state has not changed yet.
          if (effortWasUpdated && thinkingOption) {
            await activeSession
              .updateConfigOption(thinkingOption.id, sessionRecord.selectedThinkingEffort)
              .catch(() => undefined);
          }
          if (modelWasUpdated) {
            await activeSession.updateModel(sessionRecord.selectedModel).catch(() => undefined);
          }
          throw error;
        }
      }
    }

    if (options.forceNewAgentSession) {
      await this.stateMachine.stopSessionAndWait(sessionId);
    }

    try {
      await persistSelection();
      return options.forceNewAgentSession
        ? await this.restartSession(sessionId, { resumeExisting: false })
        : await this.restartSession(sessionId);
    } catch (error) {
      await rollbackSelection();
      if (options.forceNewAgentSession && providerIdChanged) {
        await this.restartSession(sessionId).catch((rollbackError: unknown) => {
          this.logger.error(
            rollbackError,
            'Failed to restore source provider after target provider startup failed',
          );
        });
      }
      throw error;
    }
  }

  async switchMode(sessionId: string, newMode: SessionMode): Promise<ACPSession | null> {
    const sessionRecord = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });

    if (!sessionRecord) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (sessionRecord.mode === newMode) {
      const active = this.getSession(sessionId);
      return active ?? null;
    }

    const wasRunning = this.stateMachine.hasSession(sessionId);
    await this.sessionWorkspace.activate(sessionId, {
      mode: newMode,
      baseBranch: sessionRecord.branch || 'main',
    });

    if (wasRunning) {
      return this.restartSession(sessionId);
    }

    return null;
  }

  getSession(sessionId: string): ACPSession | undefined {
    return this.stateMachine.getSession(sessionId);
  }

  getSnapshotService() {
    return this.stateMachine.getSnapshotService();
  }

  stopSession(sessionId: string): void {
    this.stateMachine.stopSession(sessionId);
  }

  async stopAll(): Promise<void> {
    await this.stateMachine.stopAll();
  }

  async deleteSession(sessionId: string): Promise<void> {
    const sessionRecord = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });

    if (!sessionRecord) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    this.stateMachine.stopSession(sessionId);

    if (sessionRecord.agentSessionId) {
      try {
        let providerSessions: Record<string, string> = {};
        try {
          const parsed = JSON.parse(sessionRecord.agentSessionId) as unknown;
          if (parsed && typeof parsed === 'object') {
            providerSessions = parsed as Record<string, string>;
          }
        } catch {
          const initialProvider = sessionRecord.agent || sessionRecord.selectedProvider;
          providerSessions = { [initialProvider]: sessionRecord.agentSessionId };
        }

        if (typeof this.runtime.deleteSession === 'function') {
          for (const [providerId, sId] of Object.entries(providerSessions)) {
            try {
              const { launch } = await this.resolveLaunchParameters(
                providerId,
                sessionRecord.selectedModel,
                sessionRecord.selectedThinkingEffort as ThinkingEffort,
              );
              await this.runtime.deleteSession(launch.command, launch.args, launch.env, sId);
            } catch (delErr) {
              this.logger.warn(
                { delErr, providerId },
                `Failed to delete agent session for provider ${providerId}`,
              );
            }
          }
        }
      } catch (err: unknown) {
        this.logger.error({ err, sessionId }, 'Failed to delete session on agent');
      }
    }

    await this.sessionWorkspace.teardown(sessionId).catch((err: unknown) => {
      this.logger.error({ err, sessionId }, 'Failed to teardown workspace on deleteSession');
    });

    // Clean up temporary attachments
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const os = await import('node:os');
      const attachmentsDir = path.join(os.tmpdir(), 'agentctl-attachments', sessionId);
      if (fs.existsSync(attachmentsDir)) {
        fs.rmSync(attachmentsDir, { recursive: true, force: true });
      }
    } catch (err: unknown) {
      this.logger.error({ err, sessionId }, 'Failed to cleanup attachments on deleteSession');
    }
  }

  async archiveSession(sessionId: string): Promise<void> {
    await this.sessionWorkspace.archive(sessionId);
  }

  async finalizeSession(
    sessionId: string,
    action: 'merge' | 'discard',
    commitMessage?: string,
  ): Promise<void> {
    await this.sessionWorkspace.finalize(sessionId, action === 'merge' ? 'merged' : 'discarded', {
      commitMessage,
    });
  }

  async deleteProject(projectId: string): Promise<void> {
    const projectRecord = await this.db.query.projects.findFirst({
      where: eq(projects.id, projectId),
      with: { sessions: true },
    });

    if (!projectRecord) {
      throw new Error(`Project not found: ${projectId}`);
    }

    for (const session of projectRecord.sessions) {
      await this.sessionWorkspace.teardown(session.id).catch((err: unknown) => {
        this.logger.error(
          { err, sessionId: session.id },
          'Failed to teardown workspace on deleteProject',
        );
      });
    }

    await this.db.delete(projects).where(eq(projects.id, projectId));
  }

  async getOrResuscitate(
    sessionId: string,
    options?: { allowArchived?: boolean },
  ): Promise<ACPSession | null> {
    const session = this.stateMachine.getSession(sessionId);
    if (session && !session.isDead) {
      return session;
    }

    const sessionRecord = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });

    if (!sessionRecord) {
      return null;
    }

    if (sessionRecord.status === 'merged' || sessionRecord.status === 'discarded') {
      this.logger.warn(
        { sessionId, status: sessionRecord.status },
        'Cannot resuscitate a merged or discarded session',
      );
      return null;
    }

    if (sessionRecord.status === 'archived' && !options?.allowArchived) {
      return null;
    }

    this.logger.info({ sessionId }, 'Resuscitating session runtime');
    return this.restartSession(sessionId);
  }

  async setConfigOption(
    sessionId: string,
    configId: string,
    value: string | boolean,
  ): Promise<void> {
    const session = this.stateMachine.getSession(sessionId);
    if (!session || session.isDead) {
      throw new Error(`Session is not active: ${sessionId}`);
    }

    const sessionRecord = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });
    if (!sessionRecord) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    let advertisedOptions: ACPConfigOption[];
    try {
      const parsed =
        typeof sessionRecord.sessionConfigOptions === 'string'
          ? JSON.parse(sessionRecord.sessionConfigOptions)
          : sessionRecord.sessionConfigOptions;
      if (!Array.isArray(parsed)) {
        throw new Error();
      }
      advertisedOptions = parsed as ACPConfigOption[];
    } catch {
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

    const provider = await this.providerRegistry.ensureProviderReady(
      sessionRecord.selectedProvider,
      { force: false },
    );
    if (!provider.isReady && !provider.needsAuth) {
      throw new Error(`Selected agent is not ready: ${sessionRecord.selectedProvider}`);
    }

    const isModelOption = configId === 'model' || configId === 'selectedModel';
    if (isModelOption && !provider.supportsDynamicModel) {
      throw new Error(`Provider does not support dynamic config option: ${configId}`);
    }

    await session.updateConfigOption(configId, value);
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
    },
  ) {
    const session = await this.getOrResuscitate(sessionId, { allowArchived: true });

    if (!session) {
      this.logger.warn({ sessionId }, 'Received message for unknown or non-resuscitatable session');
      return;
    }

    if (action === 'approve') {
      session.resolvePermission(String(payload.eventId), {
        allowed: true,
        optionId: payload.optionId ?? 'allow-once',
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
          await this.switchMode(sessionId, payload.mode);
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
        this.logger.warn({ sessionId }, 'Rewind called without eventId');
        return;
      }
      await this.rewindSession(sessionId, evtId, rewindMode);
    } else if (payload.input !== undefined) {
      let historyContext: string | undefined;

      const sessionRecord = await this.db.query.sessions.findFirst({
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
          const transcript = await buildConversationHistoryTranscript(this.db, sessionId, {
            maxTurns: getContextTurnLimit(),
          });
          if (transcript) {
            historyContext = transcript;
            await this.eventStore.append(
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

      this.rewindBackups.delete(sessionId);
      await session.prompt(payload.input, payload.attachmentIds, historyContext);
      // The provider now owns the conversation, even when the first prompt had no prior history.
      session.markHistoryContextTransferred?.();
    }
  }

  async setAgentPersona(sessionId: string, persona: string) {
    const sessionRecord = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });
    if (!sessionRecord) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    let availablePersonas: string[];
    try {
      const parsed = JSON.parse(sessionRecord.availableAgentPersonas) as unknown;
      availablePersonas = Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === 'string')
        : [];
    } catch {
      availablePersonas = [];
    }
    if (!availablePersonas.includes(persona)) {
      throw new Error(`Agent persona is not available for this session: ${persona}`);
    }

    const session = this.stateMachine.getSession(sessionId);
    if (session && !session.isDead) {
      await session.setMode(persona);
    }

    await this.db
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

    // Update DB
    await this.db
      .update(sessions)
      .set({
        approvalMode: validMode,
        updatedAt: new Date(),
      })
      .where(eq(sessions.id, sessionId));

    // Approval mode is a local policy and must never be sent through ACP setMode.
  }

  async rewindSession(
    sessionId: string,
    eventId: number,
    mode: 'conversation' | 'files' | 'fork',
  ): Promise<{
    forkSessionId?: string;
    undoSnapshotHash?: string;
    restoredFiles?: Array<{
      path: string;
      status: 'added' | 'modified' | 'deleted';
      additions?: number;
      deletions?: number;
    }>;
  }> {
    const sessionRecord = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });

    if (!sessionRecord) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (sessionRecord.status === 'running') {
      if (mode !== 'fork') {
        this.stateMachine.stopSession(sessionId);
        await this.db
          .update(sessions)
          .set({ status: 'idle', updatedAt: new Date() })
          .where(eq(sessions.id, sessionId));
      }
    }

    let undoSnapshotHash: string | undefined;
    let restoredFiles:
      Array<{ path: string; status: 'added' | 'modified' | 'deleted' }> | undefined;
    if (mode !== 'fork') {
      const event = await this.eventStore.getEventWithMetadata(sessionId, eventId);
      if (!event) {
        throw new Error(`Event not found: ${String(eventId)}`);
      }

      const metadata = event.metadata as { snapshotHash?: string } | undefined;

      if (mode === 'files') {
        if (!metadata?.snapshotHash) {
          throw new Error(
            'No snapshot hash available for file rewind. This project may not be a git repo.',
          );
        }

        const snapshotService = this.stateMachine.getSnapshotService();
        const projectPath =
          sessionRecord.mode === 'worktree'
            ? sessionRecord.worktreePath
            : sessionRecord.project.path;

        const restore = await snapshotService.restoreFiles(projectPath, metadata.snapshotHash);
        undoSnapshotHash = restore.backupHash;
        restoredFiles = restore.restoredFiles;
      }
    }

    if (mode === 'fork') {
      const events = await this.db
        .select()
        .from(acpEvents)
        .where(eq(acpEvents.sessionId, sessionId))
        .orderBy(asc(acpEvents.id));

      const eventsToCopy = events.filter((e) => e.id <= eventId);

      // The provider RPC forks current context, so historical and in-flight forks
      // must use the exact transcript selected above instead.
      const activeSource = this.getSession(sessionId);
      const canForkCurrentContext =
        sessionRecord.status === 'idle' &&
        eventsToCopy.length === events.length &&
        !activeSource?.requiresHistoryContext;
      const forkFromAgentSessionId = canForkCurrentContext
        ? (resolveAgentSessionId(
            sessionRecord.agentSessionId,
            sessionRecord.selectedProvider,
            sessionRecord.agent,
          ) ?? undefined)
        : undefined;
      const forkSessionId = await this.createForkSession(
        sessionRecord,
        eventsToCopy,
        forkFromAgentSessionId,
      );

      return { forkSessionId };
    }

    // conversation or files mode
    const deletedEvents = await this.eventStore.backupAndDeleteEventsAfter(sessionId, eventId);
    this.rewindBackups.set(sessionId, {
      undoSnapshotHash,
      deletedEvents,
      eventId,
      restoredFiles,
    });
    this.stateMachine.stopSession(sessionId);

    void this.restartSession(sessionId).catch((err: unknown) => {
      this.logger.error({ err, sessionId }, 'Failed to restart session after rewind');
    });

    return { undoSnapshotHash, restoredFiles };
  }

  async undoRewind(sessionId: string): Promise<void> {
    const backup = this.rewindBackups.get(sessionId);
    if (!backup) {
      throw new Error('No rewind state available to undo');
    }

    const sessionRecord = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });
    if (!sessionRecord) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (backup.undoSnapshotHash) {
      const snapshotService = this.stateMachine.getSnapshotService();
      const projectPath =
        sessionRecord.mode === 'worktree' && sessionRecord.worktreePath
          ? sessionRecord.worktreePath
          : sessionRecord.project.path;

      await snapshotService.restoreFiles(projectPath, backup.undoSnapshotHash);
    }

    if (backup.deletedEvents && backup.deletedEvents.length > 0) {
      await this.eventStore.restoreEvents(sessionId, backup.deletedEvents);
    }

    this.rewindBackups.delete(sessionId);
    this.stateMachine.stopSession(sessionId);

    void this.restartSession(sessionId).catch((err: unknown) => {
      this.logger.error({ err, sessionId }, 'Failed to restart session after undo rewind');
    });
  }

  async previewSnapshotDiff(
    sessionId: string,
    eventId: number,
  ): Promise<{
    hasSnapshot: boolean;
    files: Array<{ path: string; status: 'added' | 'modified' | 'deleted' }>;
  }> {
    const sessionRecord = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });
    if (!sessionRecord) {
      throw new Error('Session not found');
    }

    const event = await this.eventStore.getEventWithMetadata(sessionId, eventId);
    if (!event) {
      throw new Error(`Event not found: ${String(eventId)}`);
    }

    let metadata: { snapshotHash?: string } | undefined;
    if (typeof event.metadata === 'string') {
      try {
        metadata = JSON.parse(event.metadata) as { snapshotHash?: string };
      } catch {
        metadata = undefined;
      }
    } else if (typeof event.metadata === 'object' && event.metadata !== null) {
      metadata = event.metadata as { snapshotHash?: string };
    }

    if (!metadata?.snapshotHash) {
      return { hasSnapshot: false, files: [] };
    }

    const snapshotService = this.stateMachine.getSnapshotService();
    const projectPath =
      sessionRecord.mode === 'worktree' ? sessionRecord.worktreePath : sessionRecord.project.path;

    const patches = await snapshotService.diff(projectPath, metadata.snapshotHash);
    return {
      hasSnapshot: true,
      files: patches.map((p) => ({
        path: p.path,
        status: p.status,
      })),
    };
  }

  async restoreSnapshot(sessionId: string, snapshotHash: string): Promise<{ backupHash: string }> {
    const sessionRecord = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });
    if (!sessionRecord) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    const snapshotService = this.stateMachine.getSnapshotService();
    const projectPath =
      sessionRecord.mode === 'worktree' && sessionRecord.worktreePath
        ? sessionRecord.worktreePath
        : sessionRecord.project.path;

    const restore = await snapshotService.restoreFiles(projectPath, snapshotHash);
    return { backupHash: restore.backupHash };
  }

  getEventStore(): SessionEventStore {
    return this.eventStore;
  }
}
