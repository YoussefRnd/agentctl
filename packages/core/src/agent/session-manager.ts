import { spawn } from 'node:child_process';
import { eq } from 'drizzle-orm';
import type { ACPSession, DbClient } from './acp-session.js';
import type { AgentRuntime } from './acp-transport.js';
import { DefaultAgentRuntime } from './acp-transport.js';
import type { Logger } from '../logger.js';
import { noopLogger } from '../logger.js';
import { SessionEventStore } from './session-event-store.js';
import { sessions, projects } from '../db/schema.js';
import type { WorkspaceManager } from '../git/worktree-manager.js';
import { negotiateCapabilities } from './capabilities-negotiator.js';
import type { ProviderRegistry } from './acp-provider-registry.js';
import type { ProviderName, SessionMode, ThinkingEffort } from '@agentctl/shared';
import { SessionStateMachine } from './session-state-machine.js';

export interface IEventBus {
  publish(event: unknown): void;
}

export interface CreateSessionParams {
  projectId: string;
  providerId: string;
  taskSlug: string;
  mode?: SessionMode;
}

export class SessionManager {
  private eventStore: SessionEventStore;
  private stateMachine: SessionStateMachine;

  constructor(
    private db: DbClient,
    private workspaceManager: WorkspaceManager,
    private providerRegistry: ProviderRegistry,
    eventBus: IEventBus,
    private logger: Logger = noopLogger,
    private runtime: AgentRuntime = new DefaultAgentRuntime(spawn, logger),
  ) {
    this.eventStore = new SessionEventStore(db, eventBus);
    this.stateMachine = new SessionStateMachine(
      db,
      workspaceManager,
      providerRegistry,
      this.eventStore,
      logger,
      runtime,
    );
  }

  async createSession(params: CreateSessionParams): Promise<ACPSession> {
    const { projectId, providerId, taskSlug, mode } = params;

    const project = await this.db.query.projects.findFirst({
      where: eq(projects.id, projectId),
    });

    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const { launch, selection } = await this.resolveLaunchParameters(providerId);

    const sessionId = crypto.randomUUID();

    let branch = 'main';
    let worktreePath = project.path;
    let workspacePath = project.path;
    let baseCommit = 'none';
    let resolvedMode: SessionMode = mode ?? (project.repoRoot ? 'worktree' : 'local');

    if (project.repoRoot && resolvedMode === 'worktree') {
      try {
        const worktree = await this.workspaceManager.create(
          project.repoRoot,
          sessionId,
          taskSlug,
          'main',
          project.subdir,
        );
        branch = worktree.branch;
        worktreePath = worktree.path;
        workspacePath = worktree.workspacePath;
        baseCommit = worktree.baseCommit;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('empty repository')) {
          resolvedMode = 'local';
          worktreePath = project.path;
          workspacePath = project.path;
          baseCommit = 'none';
        } else {
          throw error;
        }
      }
    }

    if (resolvedMode === 'local') {
      branch = 'main';
      worktreePath = project.path;
      workspacePath = project.path;
      baseCommit = 'none';
      resolvedMode = 'local';
    }



    await this.db.insert(sessions).values({
      id: sessionId,
      projectId,
      branch,
      worktreePath,
      agent: providerId,
      status: 'idle',
      taskSlug,
      baseCommit,
      mode: resolvedMode,
      selectedProvider: providerId as ProviderName,
      selectedModel: selection.selectedModel,
      selectedThinkingEffort: selection.selectedThinkingEffort,
    });



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
      undefined,
      selection.resolvedModelConfigId,
    );
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

    const sessionRecord = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });

    if (!sessionRecord) {
      throw new Error(`Session or associated project not found: ${sessionId}`);
    }

    const { launch, selection } = await this.resolveLaunchParameters(
      sessionRecord.selectedProvider,
      sessionRecord.selectedModel,
      sessionRecord.selectedThinkingEffort as ThinkingEffort,
    );

    if (sessionRecord.status === 'archived') {
      await this.stateMachine.transitionTo(sessionId, 'idle', {
        command: launch.command,
        args: launch.args,
        env: launch.env,
        supportsDynamicModel: selection.supportsDynamicModel,
        supportsDynamicConfig: selection.supportsDynamicConfig,
        resolvedThinkingConfigId: selection.resolvedThinkingConfigId,
        resolvedModelConfigId: selection.resolvedModelConfigId,
      });
      const session = this.stateMachine.getSession(sessionId);
      if (!session) {
        throw new Error('Session failed to start after resuscitation');
      }
      return session;
    }

    const workspacePath =
      sessionRecord.mode === 'worktree'
        ? sessionRecord.worktreePath
        : sessionRecord.project.path;

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
      sessionRecord.agentSessionId,
      selection.resolvedModelConfigId,
    );
  }

  private async resolveLaunchParameters(
    providerId: string,
    requestedModel?: string,
    requestedThinkingEffort?: ThinkingEffort,
  ) {
    const provider = await this.providerRegistry.ensureProviderReady(providerId, { force: false });
    if (provider.status !== 'ready' && provider.status !== 'needs_auth') {
      throw new Error(`Selected agent is not ready: ${providerId}`);
    }

    const selection = negotiateCapabilities(
      provider,
      requestedModel,
      requestedThinkingEffort,
    );

    const launch = provider.getLaunchConfig(
      selection.selectedModel,
      selection.selectedThinkingEffort,
    );

    return { launch, selection };
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

    const providerIdChanged = sessionRecord.selectedProvider !== params.selectedProvider;

    const [updatedSession] = await this.db
      .update(sessions)
      .set({
        selectedProvider: params.selectedProvider,
        selectedModel: params.selectedModel,
        selectedThinkingEffort: params.selectedThinkingEffort,
      })
      .where(eq(sessions.id, sessionId))
      .returning();

    const provider = await this.providerRegistry.ensureProviderReady(
      updatedSession.selectedProvider,
      { force: false },
    );

    if (provider.status !== 'ready' && provider.status !== 'needs_auth') {
      return null;
    }

    const activeSession = this.stateMachine.getSession(sessionId);

    if (activeSession && !activeSession.isDead && !providerIdChanged) {
      const supportsDynamicModel = provider.supportsDynamicModel;
      const supportsDynamicConfig = provider.supportsDynamicConfig;

      if (supportsDynamicModel && params.selectedModel !== sessionRecord.selectedModel) {
        await activeSession.updateModel(params.selectedModel);
      }

      if (
        supportsDynamicConfig &&
        params.selectedThinkingEffort !== sessionRecord.selectedThinkingEffort
      ) {
        const configOptions = provider.toDiscovery().configOptions ?? [];
        const thinkingOption = configOptions.find(
          (opt) => opt.id === 'thinking' || opt.id === 'thinking_effort' || opt.id === 'selectedThinkingEffort',
        );
        if (thinkingOption) {
          try {
            await activeSession.updateConfigOption(thinkingOption.id, params.selectedThinkingEffort);
          } catch (configErr) {
            this.logger.warn(
              configErr,
              `Failed to dynamically update thinking effort (configId: ${thinkingOption.id})`
            );
          }
        }
      }

      const modelChanged = params.selectedModel !== sessionRecord.selectedModel;
      const effortChanged = params.selectedThinkingEffort !== sessionRecord.selectedThinkingEffort;

      const needsModelRestart = modelChanged && !supportsDynamicModel;
      const needsEffortRestart = effortChanged && !supportsDynamicConfig;

      if (!needsModelRestart && !needsEffortRestart) {
        return activeSession;
      }
    }

    return this.restartSession(sessionId);
  }

  async switchMode(sessionId: string, newMode: SessionMode): Promise<ACPSession | null> {
    const sessionRecord = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });

    if (!sessionRecord) {
      throw new Error(`Session or associated project not found: ${sessionId}`);
    }

    if (sessionRecord.mode === newMode) {
      const active = this.getSession(sessionId);
      return active ?? null;
    }

    const wasRunning = this.stateMachine.hasSession(sessionId);
    if (wasRunning) {
      this.stateMachine.stopSession(sessionId);
    }

    let worktreePath = sessionRecord.worktreePath;
    let branch = sessionRecord.branch;
    let baseCommit = sessionRecord.baseCommit;

    if (newMode === 'worktree') {
      if (!sessionRecord.project.repoRoot) {
        throw new Error('Project repo root not set. Cannot create worktree.');
      }
      const result = await this.workspaceManager.create(
        sessionRecord.project.repoRoot,
        sessionRecord.id,
        sessionRecord.taskSlug,
        sessionRecord.branch || 'main',
      );
      worktreePath = result.path;
      branch = result.branch;
      baseCommit = result.baseCommit;
    } else {
      if (!sessionRecord.project.repoRoot) {
        throw new Error('Project repo root not set. Cannot switch to local mode.');
      }
      worktreePath = sessionRecord.project.repoRoot;
    }

    await this.db
      .update(sessions)
      .set({
        mode: newMode,
        worktreePath,
        branch,
        baseCommit,
      })
      .where(eq(sessions.id, sessionId));

    if (wasRunning) {
      return this.restartSession(sessionId);
    }

    return null;
  }

  getSession(sessionId: string): ACPSession | undefined {
    return this.stateMachine.getSession(sessionId);
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
      with: { project: true },
    });

    if (!sessionRecord) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    this.stateMachine.stopSession(sessionId);

    if (sessionRecord.mode === 'worktree' && sessionRecord.project.repoRoot) {
      try {
        await this.workspaceManager.cleanup(
          sessionRecord.project.repoRoot,
          sessionRecord.worktreePath,
          sessionRecord.branch,
        );
      } catch (err: unknown) {
        this.logger.error({ err, sessionId }, 'Failed to cleanup worktree on deleteSession');
      }
    }

    await this.db.delete(sessions).where(eq(sessions.id, sessionId));

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
    await this.stateMachine.transitionTo(sessionId, 'archived');
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
      this.stateMachine.stopSession(session.id);
      if (session.mode === 'worktree' && projectRecord.repoRoot) {
        try {
          await this.workspaceManager.cleanup(
            projectRecord.repoRoot,
            session.worktreePath,
            session.branch,
          );
        } catch (err: unknown) {
          this.logger.error({ err, sessionId: session.id }, 'Failed to cleanup worktree on deleteProject');
        }
      }
    }

    await this.db.delete(projects).where(eq(projects.id, projectId));
  }

  async handleClientMessage(
    sessionId: string,
    action: 'approve' | 'deny' | 'session.input',
    payload: { eventId?: string | number; optionId?: string; input?: string; attachmentIds?: string[] },
  ) {
    let session = this.stateMachine.getSession(sessionId);

    if (!session || session.isDead) {
      const sessionRecord = await this.db.query.sessions.findFirst({
        where: eq(sessions.id, sessionId),
      });

      if (!sessionRecord) {
        this.logger.warn({ sessionId }, 'Received message for unknown session');
        return;
      }

      if (sessionRecord.status === 'merged' || sessionRecord.status === 'discarded') {
        this.logger.warn({ sessionId, status: sessionRecord.status }, 'Cannot resuscitate a merged or discarded session');
        return;
      }

      this.logger.info({ sessionId }, 'Resuscitating session runtime');
      session = await this.restartSession(sessionId);
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
    } else if (payload.input !== undefined) {
      await session.prompt(payload.input, payload.attachmentIds);
    }
  }
}
