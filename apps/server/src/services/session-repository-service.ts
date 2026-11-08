import { eq } from 'drizzle-orm';
import { sessions, type DbClient } from '@agentctl/core/db';
import type {
  RepositoryService,
  SourceRepository,
  RepositoryReviewOptions,
} from '@agentctl/core/repository';
import type { RepositoryReview, RevisionReference, SourceRepositoryInfo } from '@agentctl/shared';
import { AppError } from '../errors/app-error.js';

export async function openSessionRepository(
  db: DbClient,
  repositories: Pick<RepositoryService, 'open'>,
  sessionId: string,
) {
  const session = await db.query.sessions.findFirst({ where: eq(sessions.id, sessionId) });
  if (!session) throw new AppError('Session not found', 404);
  const repository = await repositories.open(session.worktreePath);
  return { session, repository };
}

export function importSessionBaseline(repository: SourceRepository, selector: string) {
  // Older sessions store backend-native selectors. Expose only scoped, opaque revisions to clients.
  return selector === 'none' ? undefined : repository.importRevision(selector);
}

export class SessionRepositoryService {
  constructor(
    private readonly db: DbClient,
    private readonly repositories: Pick<RepositoryService, 'open'>,
  ) {}

  async getInfo(sessionId: string): Promise<SourceRepositoryInfo> {
    return (await openSessionRepository(this.db, this.repositories, sessionId)).repository.info;
  }

  async getReview(sessionId: string, options: RepositoryReviewOptions): Promise<RepositoryReview> {
    const { session, repository } = await openSessionRepository(
      this.db,
      this.repositories,
      sessionId,
    );
    const baseline = repository.info.capabilities.review
      ? await importSessionBaseline(repository, session.baseCommit)
      : undefined;
    return repository.review(baseline, options);
  }

  async getFileDiff(
    sessionId: string,
    from: RevisionReference,
    to: RevisionReference,
    filePath: string,
  ): Promise<RepositoryReview> {
    const { repository } = await openSessionRepository(this.db, this.repositories, sessionId);
    const files = await repository.diff(from, to, filePath);
    return { repository: repository.info, files };
  }
}
