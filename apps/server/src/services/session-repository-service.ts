import { eq } from 'drizzle-orm';
import { sessions, type DbClient } from '@agentctl/core/db';
import type {
  RepositoryService,
  SourceRepository,
  RepositoryReviewOptions,
} from '@agentctl/core/repository';
import type { RepositoryReview, RevisionReference, SourceRepositoryInfo } from '@agentctl/shared';
import { AppError } from '../errors/app-error.js';

/** Session lookup and legacy baseline import belong to the application, not the transport. */
export class SessionRepositoryService {
  constructor(
    private readonly db: DbClient,
    private readonly repositories: Pick<RepositoryService, 'open'>,
  ) {}

  private async context(sessionId: string) {
    const session = await this.db.query.sessions.findFirst({ where: eq(sessions.id, sessionId) });
    if (!session) throw new AppError('Session not found', 404);
    const repository = await this.repositories.open(session.worktreePath);
    return { session, repository };
  }

  async getInfo(sessionId: string): Promise<SourceRepositoryInfo> {
    return (await this.context(sessionId)).repository.info;
  }

  async getReview(sessionId: string, options: RepositoryReviewOptions): Promise<RepositoryReview> {
    const { session, repository } = await this.context(sessionId);
    const baseline = await this.importBaseline(repository, session.baseCommit);
    return repository.review(baseline, options);
  }

  async getFileDiff(
    sessionId: string,
    from: RevisionReference,
    to: RevisionReference,
    filePath: string,
  ): Promise<RepositoryReview> {
    const { repository } = await this.context(sessionId);
    const files = await repository.diff(from, to, filePath);
    return { repository: repository.info, files };
  }

  private async importBaseline(
    repository: SourceRepository,
    selector: string,
  ): Promise<RevisionReference | undefined> {
    // Older session records store backend-native selectors. Keep that compatibility
    // at this boundary; clients receive only scoped, opaque revision references.
    return repository.info.capabilities.review && selector !== 'none'
      ? repository.resolveRevision(selector)
      : undefined;
  }
}
