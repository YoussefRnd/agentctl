import { sessions, projects } from '@agentctl/core';
import { eq } from 'drizzle-orm';
import { AppError } from '../errors/app-error.js';
import type { 
  db as defaultDb, 
  SessionManager, 
  WorktreeManager, 
  ProviderRegistry 
} from '@agentctl/core';
import type { FastifyBaseLogger } from 'fastify';
import type { SessionMode, ApprovalMode } from '@agentctl/shared';

export class SessionService {
  constructor(
    private db: typeof defaultDb,
    private sessionManager: SessionManager,
    private worktreeManager: WorktreeManager,
    private providerRegistry: ProviderRegistry,
    private log: FastifyBaseLogger,
  ) {}

  async createSession(params: {
    projectId: string;
    providerId: string;
    taskSlug: string;
    mode?: SessionMode;
  }) {
    const session = await this.sessionManager.createSession(params);

    const sessionRecord = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, session.sessionId),
      with: { project: true },
    });

    if (!sessionRecord) {
      throw new AppError('Failed to retrieve created session', 500);
    }

    return sessionRecord;
  }

  async getSessionWithCapabilities(sessionId: string) {
    const session = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });

    if (!session) {
      throw new AppError('Session not found', 404);
    }

    const providersList = await this.providerRegistry.discover();
    return { session, capabilities: providersList };
  }

  async updateSessionProvider(sessionId: string, config: {
    selectedProvider: string;
    selectedModel: string;
    selectedThinkingEffort: 'low' | 'medium' | 'high';
  }) {
    const session = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });

    if (!session) {
      throw new AppError('Session not found', 404);
    }

    await this.sessionManager.updateSessionConfig(sessionId, config);

    const updatedSession = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });

    if (!updatedSession) {
      throw new AppError('Session not found', 404);
    }

    const providersList = await this.providerRegistry.discover();
    return { session: updatedSession, capabilities: providersList };
  }

  async listBranches(sessionId: string) {
    const session = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });

    if (!session) {
      throw new AppError('Session not found', 404);
    }

    const project = await this.db.query.projects.findFirst({
      where: eq(projects.id, session.projectId),
    });

    if (!project?.repoRoot) {
      return [];
    }

    return await this.worktreeManager.listBranches(project.repoRoot);
  }

  async checkoutBranch(sessionId: string, branchName: string) {
    const session = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });

    if (!session) {
      throw new AppError('Session not found', 404);
    }

    // Checkout the branch in the worktree
    await this.worktreeManager.checkout(session.worktreePath, branchName);

    // Update database
    const [updatedSession] = await this.db
      .update(sessions)
      .set({
        branch: branchName,
      })
      .where(eq(sessions.id, sessionId))
      .returning();

    // If session is running, restart the connection to reload new state
    const activeSession = this.sessionManager.getSession(sessionId);
    if (activeSession) {
      const provider = await this.providerRegistry.ensureProviderReady(
        updatedSession.selectedProvider,
        { force: false },
      );
      if (provider.status === 'ready' || provider.status === 'needs_auth') {
        await this.sessionManager.restartSession(sessionId);
      }
    }

    return updatedSession;
  }

  async switchMode(sessionId: string, mode: SessionMode) {
    const session = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });

    if (!session) {
      throw new AppError('Session not found', 404);
    }

    await this.sessionManager.switchMode(sessionId, mode);

    const updatedSession = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });

    if (!updatedSession) {
      throw new AppError('Session not found', 404);
    }

    return updatedSession;
  }

  async updateApprovalMode(sessionId: string, approvalMode: ApprovalMode) {
    const session = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });

    if (!session) {
      throw new AppError('Session not found', 404);
    }

    const [updatedSession] = await this.db
      .update(sessions)
      .set({ approvalMode })
      .where(eq(sessions.id, sessionId))
      .returning();

    return updatedSession;
  }

  async finalizeSession(sessionId: string, action: 'merge' | 'discard', commitMessage?: string) {
    const session = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });

    if (!session) {
      throw new AppError('Session not found', 404);
    }

    const project = session.project;

    if (session.mode === 'worktree') {
      if (!project.repoRoot) {
        throw new AppError(`Project repo root not set. Cannot ${action}.`, 400);
      }

      // Stop session process
      this.sessionManager.stopSession(sessionId);

      await this.worktreeManager.finalize(
        project.repoRoot,
        session.worktreePath,
        session.branch,
        'main', // default to main
        action,
        session.taskSlug,
        commitMessage,
      );
    } else {
      // Stop session process
      this.sessionManager.stopSession(sessionId);
    }

    // Update session status in DB
    const [updatedSession] = await this.db
      .update(sessions)
      .set({
        status: action === 'merge' ? 'merged' : 'discarded',
        closedAt: new Date(),
      })
      .where(eq(sessions.id, sessionId))
      .returning();

    return updatedSession;
  }

  async deleteSession(sessionId: string) {
    await this.sessionManager.deleteSession(sessionId);
  }

  async archiveSession(sessionId: string) {
    await this.sessionManager.archiveSession(sessionId);
  }

  async restartSession(sessionId: string) {
    await this.sessionManager.restartSession(sessionId);
  }
}
