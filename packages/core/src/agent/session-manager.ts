import { spawn } from 'node:child_process';
import { eq } from 'drizzle-orm';
import { ACPSession, type DbClient } from './acp-session.js';
import type { AgentRuntime, AgentRuntimeHandle } from './acp-transport.js';
import { DefaultAgentRuntime, AuthRequiredError } from './acp-transport.js';
import type { Logger } from '../logger.js';
import { noopLogger } from '../logger.js';
import { SessionEventStore } from './session-event-store.js';
import { sessions, projects } from '../db/schema.js';
import type { WorkspaceManager } from '../git/worktree-manager.js';
import { negotiateCapabilities } from './capabilities-negotiator.js';
import type { ProviderRegistry } from './acp-provider-registry.js';
import type { ProviderName, SessionMode, ThinkingEffort } from '@agentctl/shared';

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
  private sessions = new Map<string, ACPSession>();
  private eventStore: SessionEventStore;

  constructor(
    private db: DbClient,
    private workspaceManager: WorkspaceManager,
    private providerRegistry: ProviderRegistry,
    eventBus: IEventBus,
    private logger: Logger = noopLogger,
    private runtime: AgentRuntime = new DefaultAgentRuntime(spawn, logger),
  ) {
    this.eventStore = new SessionEventStore(db, eventBus);
  }

  async createSession(params: CreateSessionParams): Promise<ACPSession> {
    const { projectId, providerId, taskSlug, mode } = params;

    const project = await this.db.query.projects.findFirst({
      where: eq(projects.id, projectId),
    });

    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const provider = await this.providerRegistry.ensureProviderReady(providerId, { force: false });
    if (provider.status !== 'ready' && provider.status !== 'needs_auth') {
      throw new Error(`Selected agent is not ready: ${providerId}`);
    }

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

    const selection = negotiateCapabilities(provider, undefined, undefined);

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

    const launch = provider.getLaunchConfig(
      selection.selectedModel,
      selection.selectedThinkingEffort,
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
  ): Promise<ACPSession> {
    this.logger.info({ sessionId, command, args, worktreePath }, 'Starting new agent session');

    let session: ACPSession | undefined;

    try {
      const runtimeHandle = await this.runtime.execute(
        command,
        args,
        {
          cwd: worktreePath,
          env,
          selectedModel,
          selectedThinkingEffort,
          supportsDynamicModel,
          supportsDynamicConfig,
        },
        {
          onUpdate: async (notification) => {
            if (session) {
              await session.handleNotification(notification);
            }
          },
          onRequestPermission: async (req) => {
            if (session) {
              return await session.handleRequestPermission(req);
            }
            return { outcome: { outcome: 'cancelled' } };
          },
        },
      );

      session = new ACPSession(
        sessionId,
        runtimeHandle,
        this.db,
        this.eventStore,
        worktreePath,
        this.logger,
      );

      await this.db
        .update(sessions)
        .set({ agentSessionId: runtimeHandle.acpSessionId, status: 'running' })
        .where(eq(sessions.id, sessionId));

    } catch (err: unknown) {
      if (err instanceof AuthRequiredError) {
        this.logger.warn(`Session ${sessionId} requires authentication`);
        await this.db
          .update(sessions)
          .set({ status: 'needs_attention' })
          .where(eq(sessions.id, sessionId));

        await this.eventStore.append(sessionId, 'status', {
          status: 'needs_auth',
          message: 'Authentication required. Please check your API keys or log in via CLI.',
        });

        const runtimeHandle: AgentRuntimeHandle = {
          acpSessionId: null,
          connection: err.connection,
          child: err.child,
          closed: err.connection.closed,
          prompt: () => Promise.resolve(),
          respondToPermission: () => undefined,
          stop(): Promise<void> {
            err.child.kill();
            return Promise.resolve();
          },
        };

        session = new ACPSession(
          sessionId,
          runtimeHandle,
          this.db,
          this.eventStore,
          worktreePath,
          this.logger,
        );
      } else {
        throw err;
      }
    }

    this.sessions.set(sessionId, session);
    return session;
  }

  async restartSession(sessionId: string): Promise<ACPSession> {
    this.logger.info({ sessionId }, 'Restarting session');
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.kill();
      this.sessions.delete(sessionId);
    }

    const sessionRecord = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });

    if (!sessionRecord) {
      throw new Error(`Session or associated project not found: ${sessionId}`);
    }

    const provider = await this.providerRegistry.ensureProviderReady(
      sessionRecord.selectedProvider,
      { force: false },
    );

    const workspacePath =
      sessionRecord.mode === 'worktree'
        ? sessionRecord.worktreePath
        : sessionRecord.project.path;

    const selection = negotiateCapabilities(
      provider,
      sessionRecord.selectedModel,
      sessionRecord.selectedThinkingEffort as ThinkingEffort,
    );

    const launch = provider.getLaunchConfig(
      selection.selectedModel,
      selection.selectedThinkingEffort,
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
    );
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

    const activeSession = this.sessions.get(sessionId);

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
        await activeSession.updateConfigOption('thinking_effort', params.selectedThinkingEffort);
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

    const wasRunning = this.sessions.has(sessionId);
    if (wasRunning) {
      this.stopSession(sessionId);
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
    return this.sessions.get(sessionId);
  }

  stopSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.kill();
      this.sessions.delete(sessionId);
    }
  }

  async stopAll(): Promise<void> {
    const stopPromises = Array.from(this.sessions.values()).map((session) => session.stop());
    await Promise.all(stopPromises);
    this.sessions.clear();
  }

  async handleClientMessage(
    sessionId: string,
    action: 'approve' | 'deny' | 'session.input',
    payload: { eventId?: string | number; input?: string },
  ) {
    let session = this.sessions.get(sessionId);

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
        outcome: { outcome: 'selected', optionId: 'allow-once' },
      });
    } else if (action === 'deny') {
      session.resolvePermission(String(payload.eventId), {
        outcome: { outcome: 'cancelled' },
      });
    } else if (payload.input) {
      await session.prompt(payload.input);
    }
  }
}
