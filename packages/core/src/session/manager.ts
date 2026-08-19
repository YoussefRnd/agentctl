import { spawn } from 'node:child_process';
import { eq, asc, inArray } from 'drizzle-orm';
import { simpleGit } from 'simple-git';
import type { ACPSession } from '../acp/session-client.js';
import type { DbClient } from '../db/index.js';
import type { AgentRuntime } from '../acp/types.js';
import { DefaultAgentRuntime } from '../acp/runtime.js';
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

export interface IEventBus {
  publish(event: unknown): void;
}

export interface CreateSessionParams {
  projectId: string;
  providerId?: string;
  taskSlug: string;
  mode?: SessionMode;
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

  constructor(
    private db: DbClient,
    private workspaceManager: WorkspaceManager,
    private providerRegistry: ProviderRegistry,
    eventBus: IEventBus,
    private logger: Logger = noopLogger,
    private runtime: AgentRuntime = new DefaultAgentRuntime(spawn, logger),
    private mcpGateway?: McpGateway,
  ) {
    if (this.runtime instanceof DefaultAgentRuntime) {
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

  async createSession(params: CreateSessionParams): Promise<{ sessionId: string }> {
    const { projectId, providerId, taskSlug, mode } = params;

    const settings = this.providerRegistry.getSettings();
    const resolvedProviderId = providerId ?? settings.defaultProviderId ?? undefined;

    if (!resolvedProviderId) {
      throw new Error(
        'No agent provider specified, and no default provider is configured in settings.',
      );
    }

    const { selection, configOptions } = await this.resolveLaunchParameters(resolvedProviderId);

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
    selectedModel = 'default',
    selectedThinkingEffort: ThinkingEffort = 'medium',
    supportsDynamicModel = false,
    supportsDynamicConfig = false,
    resolvedThinkingConfigId?: string,
    existingAgentSessionId?: string | null,
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
      existingAgentSessionId,
      resolvedModelConfigId,
    );
  }

  async restartSession(sessionId: string): Promise<ACPSession> {
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

    const resolvedAgentSessionId = resolveAgentSessionId(
      sessionRecord.agentSessionId,
      sessionRecord.selectedProvider,
      sessionRecord.agent,
    );

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
      resolvedAgentSessionId,
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
      project: { path: string; repoRoot: string | null; subdir: string };
    },
    eventsToCopy: {
      type: string;
      data: unknown;
      parentEventId: number | null;
      metadata: string | null;
    }[],
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
        contextLimit: 0,
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
      undefined,
      selection.resolvedModelConfigId,
    );

    return forkSessionId;
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
      await this.db
        .update(sessions)
        .set({
          selectedProvider: params.selectedProvider,
          selectedModel: selection.selectedModel,
          selectedThinkingEffort: selection.selectedThinkingEffort,
          contextLimit: 0,
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

    if (activeSession && !activeSession.isDead && !providerIdChanged) {
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

    await persistSelection();
    try {
      return await this.restartSession(sessionId);
    } catch (error) {
      await rollbackSelection();
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

        if (typeof this.runtime.deleteAgentSession === 'function') {
          for (const [providerId, sId] of Object.entries(providerSessions)) {
            try {
              const { launch } = await this.resolveLaunchParameters(
                providerId,
                sessionRecord.selectedModel,
                sessionRecord.selectedThinkingEffort as ThinkingEffort,
              );
              await this.runtime.deleteAgentSession(launch.command, launch.args, launch.env, sId);
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
        const hasExistingProviderSession = Boolean(existingAgentSessionId);

        if (!hasExistingProviderSession) {
          const transcript = await buildConversationHistoryTranscript(this.db, sessionId, {
            maxTurns: 10,
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

      await session.prompt(payload.input, payload.attachmentIds, historyContext);
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
  ): Promise<{ forkSessionId?: string }> {
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

        const patches = await snapshotService.diff(projectPath, metadata.snapshotHash);

        const modifiedPatches = patches.filter(
          (p) => p.status === 'modified' || p.status === 'added',
        );
        if (modifiedPatches.length > 0) {
          const git = simpleGit(projectPath);
          const changedFiles = modifiedPatches.map((p) => p.path);
          try {
            await git.raw(['stash', 'push', '--', ...changedFiles]);
          } catch {
            // If stash fails (no changes to stash), continue
          }
        }

        await snapshotService.revertFiles(projectPath, metadata.snapshotHash, patches);
      }
    }

    if (mode === 'fork') {
      const events = await this.db
        .select()
        .from(acpEvents)
        .where(eq(acpEvents.sessionId, sessionId))
        .orderBy(asc(acpEvents.id));

      const eventsToCopy = events.filter((e) => e.id <= eventId);

      const forkSessionId = await this.createForkSession(sessionRecord, eventsToCopy);

      return { forkSessionId };
    }

    // conversation mode (default)
    await this.eventStore.deleteEventsAfter(sessionId, eventId);
    this.stateMachine.stopSession(sessionId);

    void this.restartSession(sessionId).catch((err: unknown) => {
      this.logger.error({ err, sessionId }, 'Failed to restart session after rewind');
    });

    return {};
  }
}
