import { eq } from 'drizzle-orm';
import { sessions, type DbClient } from '@agentctl/core/db';
import type { SessionManager } from '@agentctl/core/session';
import type { GitRepositoryAccess } from '@agentctl/core/git';
import type { SessionDetailRecord } from './session-queries.js';

/** Explicit compatibility operation invoked before the legacy session-detail query response. */
export class SessionReconciler {
  constructor(
    private readonly db: DbClient,
    private readonly sessionManager: Pick<
      SessionManager,
      'ensureWorkspaceAvailable' | 'getSnapshotService' | 'getEventRepository'
    >,
    private readonly worktreeManager: Pick<GitRepositoryAccess, 'getCurrentBranch'>,
  ) {}
  async reconcile(session: SessionDetailRecord): Promise<void> {
    const sessionId = session.id;
    if (session.mode === 'worktree') {
      await this.sessionManager.ensureWorkspaceAvailable(sessionId);
    }

    if (session.project.repoRoot && session.worktreePath === session.project.path) {
      const currentBranch = await this.worktreeManager
        .getCurrentBranch(session.worktreePath)
        .catch(() => null);
      if (currentBranch !== null && currentBranch !== session.branch) {
        const snapshotService = this.sessionManager.getSnapshotService();
        const treeHash = await snapshotService.track(session.worktreePath).catch(() => undefined);
        const newBaseCommit = treeHash ?? session.baseCommit;
        await this.db
          .update(sessions)
          .set({ branch: currentBranch, baseCommit: newBaseCommit })
          .where(eq(sessions.id, sessionId));
        session.branch = currentBranch;
        session.baseCommit = newBaseCommit;
      }
    }

    if (session.totalTokens <= 0) {
      const eventRepository = this.sessionManager.getEventRepository();
      await eventRepository.recalculateTotalTokens(sessionId).catch(() => undefined);
      const refreshed = await this.db.query.sessions.findFirst({
        where: eq(sessions.id, sessionId),
        with: { project: true },
      });
      if (refreshed && refreshed.totalTokens > 0) {
        session.totalTokens = refreshed.totalTokens;
      }
    }

    if (session.contextLimit <= 0 && session.sessionMetrics) {
      try {
        const parsed = JSON.parse(session.sessionMetrics) as { contextLimit?: number };
        if (typeof parsed.contextLimit === 'number' && parsed.contextLimit > 0) {
          await this.db
            .update(sessions)
            .set({ contextLimit: parsed.contextLimit })
            .where(eq(sessions.id, sessionId));
          session.contextLimit = parsed.contextLimit;
        }
      } catch {
        // ignore
      }
    }
  }
}
