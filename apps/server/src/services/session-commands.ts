import { sessions, type DbClient } from '@agentctl/core/db';
import { eq } from 'drizzle-orm';
import { AppError } from '../errors/app-error.js';
import type { SessionManager } from '@agentctl/core/session';
import type { ProviderRegistry } from '@agentctl/core/providers';
import type { FastifyBaseLogger } from 'fastify';
import {
  type HandoffSessionResponse,
  type ElicitationResponse,
  type SessionMode,
  sessionRowSchema,
  type SessionRow,
  type ThinkingEffort,
} from '@agentctl/shared';

/** Session application commands; the facade exposes their stable calling surface. */
export class SessionCommands {
  constructor(
    private readonly db: DbClient,
    private readonly sessionManager: SessionManager,
    private readonly providerRegistry: ProviderRegistry,
    private readonly log: FastifyBaseLogger,
  ) {}
  private parseSessionRow(raw: unknown): SessionRow {
    return sessionRowSchema.parse(raw);
  }

  async createSession(params: {
    projectId: string;
    providerId?: string;
    taskSlug: string;
    mode?: SessionMode;
    selectedModel?: string;
    selectedThinkingEffort?: ThinkingEffort;
    approvalMode?: 'review' | 'auto_approve' | 'yolo';
    agentPersona?: string;
  }) {
    const session = await this.sessionManager.createSession(params);

    const sessionRecord = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, session.sessionId),
      with: { project: true },
    });

    if (!sessionRecord) {
      throw new AppError('Failed to retrieve created session', 500);
    }

    return this.parseSessionRow({ ...sessionRecord, hasUserActivity: false });
  }

  async updateSessionProvider(
    sessionId: string,
    config: {
      selectedProvider: string;
      selectedModel: string;
      selectedThinkingEffort?: ThinkingEffort;
    },
  ) {
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
    return {
      session: this.parseSessionRow(updatedSession),
      capabilities: providersList,
    };
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

    return this.parseSessionRow(updatedSession);
  }

  async updateApprovalMode(sessionId: string, approvalMode: string) {
    const session = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });

    if (!session) {
      throw new AppError('Session not found', 404);
    }

    await this.sessionManager.updateApprovalMode(sessionId, approvalMode);

    const updatedSession = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });

    if (!updatedSession) {
      throw new AppError('Session not found', 404);
    }

    return this.parseSessionRow(updatedSession);
  }

  async finalizeSession(
    sessionId: string,
    action: 'merge' | 'discard',
    commitMessage?: string,
    targetBranch?: string,
  ) {
    const session = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });

    if (!session) {
      throw new AppError('Session not found', 404);
    }

    if (targetBranch && session.mode !== 'worktree')
      throw new AppError('Destination branches apply only to worktree sessions', 400);
    try {
      await this.sessionManager.finalizeSession(sessionId, action, commitMessage, targetBranch);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.includes('Merge conflict') ||
        message.includes('Working tree is not clean') ||
        message.includes('sandbox')
      ) {
        throw new AppError(message, 400);
      }
      throw err;
    }

    const updatedSession = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });

    if (!updatedSession) {
      throw new AppError('Session not found after finalization', 500);
    }

    return this.parseSessionRow(updatedSession);
  }

  async deleteSession(sessionId: string) {
    await this.sessionManager.deleteSession(sessionId);
  }

  async archiveSession(sessionId: string) {
    await this.sessionManager.archiveSession(sessionId);
  }

  async restartSession(sessionId: string) {
    await this.sessionManager.reconnectSession(sessionId);
  }

  async cancelSession(sessionId: string) {
    await this.sessionManager.handleClientMessage(sessionId, 'cancel', {});
  }

  writeTerminalInput(sessionId: string, terminalId: string, data: string): boolean {
    return this.sessionManager.writeTerminalInput(sessionId, terminalId, data);
  }

  async rewindSession(sessionId: string, eventId: number, mode: 'conversation' | 'files' | 'fork') {
    return await this.sessionManager.rewindSession(sessionId, eventId, mode);
  }

  async undoRewind(sessionId: string) {
    return await this.sessionManager.undoRewind(sessionId);
  }

  async handoffSession(
    sessionId: string,
    targetProvider: string,
    targetModel?: string,
    nextSessionFocus?: string,
  ): Promise<HandoffSessionResponse> {
    try {
      return await this.sessionManager.handoffSession(
        sessionId,
        targetProvider,
        targetModel,
        nextSessionFocus,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to handoff session';
      if (message.startsWith('Session not found:')) {
        throw new AppError(message, 404);
      }
      if (
        message.includes('current agent turn') ||
        message.includes('source agent started another turn') ||
        message.includes('already using provider')
      ) {
        throw new AppError(message, 409);
      }
      throw error;
    }
  }

  async previewSnapshotDiff(sessionId: string, eventId: number) {
    return await this.sessionManager.previewSnapshotDiff(sessionId, eventId);
  }

  async restoreSnapshot(sessionId: string, snapshotHash: string) {
    return await this.sessionManager.restoreSnapshot(sessionId, snapshotHash);
  }

  async spawnParallelAgent(
    parentSessionId: string,
    params: {
      prompt: string;
      title?: string;
      taskSlug?: string;
      providerId?: string;
      modelId?: string;
    },
  ) {
    const parentSession = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, parentSessionId),
      with: { project: true },
    });

    if (!parentSession) {
      throw new AppError('Parent session not found', 404);
    }

    const randomSuffix = Math.random().toString(36).substring(2, 7);
    const taskSlug = params.taskSlug || `agent-${randomSuffix}`;
    const title = params.title || `Agent: ${params.prompt.slice(0, 40).trim()}`;

    // Create session in worktree mode
    const created = await this.sessionManager.createSession({
      projectId: parentSession.projectId,
      taskSlug,
      providerId: params.providerId ?? parentSession.selectedProvider ?? undefined,
      mode: 'worktree',
    });

    // Update title
    await this.db
      .update(sessions)
      .set({ title, updatedAt: new Date() })
      .where(eq(sessions.id, created.sessionId));

    // Send initial prompt input to subagent
    void this.sessionManager.startInput(created.sessionId, params.prompt).catch((err: unknown) => {
      this.log.error({ err, sessionId: created.sessionId }, 'Failed to send prompt to subagent');
    });

    const sessionRecord = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, created.sessionId),
      with: { project: true },
    });

    if (!sessionRecord) {
      throw new AppError('Failed to retrieve spawned subagent session', 500);
    }

    return this.parseSessionRow(sessionRecord);
  }

  async renameSession(sessionId: string, title: string) {
    const session = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });

    if (!session) {
      throw new AppError('Session not found', 404);
    }

    await this.db
      .update(sessions)
      .set({ title, updatedAt: new Date() })
      .where(eq(sessions.id, sessionId));

    const activeSession = this.sessionManager.getSession(sessionId);
    if (activeSession) {
      await activeSession.eventRepository.append(
        sessionId,
        'status',
        {
          status: 'session_info_update',
          title,
          updatedAt: new Date().toISOString(),
        },
        null,
      );
    }
  }

  respondToElicitation(sessionId: string, elicitationId: string, response: ElicitationResponse) {
    const activeSession = this.sessionManager.getSession(sessionId);
    if (!activeSession) {
      throw new AppError('Active session not found', 404);
    }
    let ok: boolean;
    try {
      ok = activeSession.respondToElicitation(elicitationId, response);
    } catch (error) {
      throw new AppError(
        error instanceof Error ? error.message : 'Invalid elicitation response',
        400,
      );
    }
    if (!ok) {
      throw new AppError('Elicitation not found or already completed', 400);
    }
  }

  getSnapshotService() {
    return this.sessionManager.getSnapshotService();
  }
}
