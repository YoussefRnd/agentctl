import { spawn } from 'node:child_process';
import { eq } from 'drizzle-orm';
import { ACPSession, type DbClient } from './acp-session.js';
import { cleanEnv } from './acp-transport.js';
import type { Logger } from '../logger.js';
import { noopLogger } from '../logger.js';
import { SessionEventStore } from './session-event-store.js';
import { sessions, projects } from '../db/schema.js';
import type { WorkspaceManager } from '../git/worktree-manager.js';
import type { ProviderRegistry } from './acp-provider-registry.js';
import type { ProviderName, SessionMode } from '@agentctl/shared';

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
          project.subdir ?? '',
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

    const selection = provider.resolveDefaultSelection();

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
    );
  }

  startSession(
    sessionId: string,
    worktreePath: string,
    command: string,
    args: string[],
    env?: Record<string, string>,
  ): ACPSession {
    this.logger.info({ sessionId, command, args, worktreePath }, 'Starting new agent session');

    const child = spawn(command, args, {
      cwd: worktreePath,
      env: cleanEnv(env),
    });

    const session = new ACPSession(
      sessionId,
      child,
      this.db,
      this.eventStore,
      worktreePath,
      this.logger,
    );

    void session.initialize().catch((err: unknown) => {
      this.logger.error(err, `Failed to initialize session ${sessionId}`);
    });

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

    if (!sessionRecord || !sessionRecord.project) {
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

    const launch = provider.getLaunchConfig(
      sessionRecord.selectedModel ?? 'default',
      sessionRecord.selectedThinkingEffort ?? 'medium',
    );

    return this.startSession(
      sessionId,
      workspacePath,
      launch.command,
      launch.args,
      launch.env,
    );
  }

  async switchMode(sessionId: string, newMode: SessionMode): Promise<ACPSession | null> {
    const sessionRecord = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });

    if (!sessionRecord || !sessionRecord.project) {
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
    } else if (newMode === 'local') {
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
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.logger.warn({ sessionId }, 'Received message for unknown session');
      return;
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
