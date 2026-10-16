import path from 'node:path';
import type { GitMutex } from '../mutex.js';
import { SnapshotService } from '../snapshot-service.js';
import type { ReviewFile } from '../utils.js';
import type { WorkspaceStorage } from './types.js';
export class GitWorkspaceReview {
  private reviewService?: SnapshotService;
  constructor(
    private readonly gitMutex: GitMutex,
    private readonly storage: WorkspaceStorage,
  ) {}
  reset(): void {
    this.reviewService = undefined;
  }
  private review(): SnapshotService {
    return (this.reviewService ??= new SnapshotService(
      path.join(this.storage.baseDir, '.review-indexes'),
    ));
  }

  async getDiff(repoPath: string, worktreePath: string, baseCommit: string): Promise<string> {
    return this.gitMutex.run(repoPath, async () => {
      const files = await this.review().getReviewFiles(worktreePath, baseCommit, {
        scope: 'session',
      });
      return files
        .map((file) => file.diff)
        .filter(Boolean)
        .join('\n');
    });
  }

  async getReviewFiles(
    repoPath: string,
    worktreePath: string,
    baseCommit: string,
  ): Promise<ReviewFile[]> {
    return this.gitMutex.run(repoPath, () =>
      this.review().getReviewFiles(worktreePath, baseCommit, { scope: 'working' }),
    );
  }
}
