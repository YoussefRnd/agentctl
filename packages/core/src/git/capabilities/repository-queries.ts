import { simpleGit } from 'simple-git';
import { resolveRepositoryContext } from '../repository-context.js';
import type { RepositoryInfo, BaseRefInfo } from './types.js';
export class GitRepositoryQueries {
  async resolveRepository(selectedPath: string): Promise<RepositoryInfo> {
    const {
      selectedPath: canonicalPath,
      isGitRepo,
      repoRoot,
      workdirPrefix,
    } = await resolveRepositoryContext(selectedPath);
    return { selectedPath: canonicalPath, isGitRepo, repoRoot, workdirPrefix };
  }

  async resolveBaseRef(repoPath: string, preferredRef = 'main'): Promise<BaseRefInfo> {
    const git = simpleGit(repoPath);
    const currentBranch = await this.getCurrentBranch(repoPath);

    // If preferredRef is not found in the local repository, fallback to current active branch
    let ref = preferredRef;
    let commit: string;

    try {
      commit = await git.revparse([ref]);
      return {
        ref,
        commit: commit.trim(),
        isEmpty: false,
      };
    } catch {
      ref = currentBranch;
      try {
        commit = await git.revparse([ref]);
        return {
          ref,
          commit: commit.trim(),
          isEmpty: false,
        };
      } catch {
        return {
          ref,
          commit: 'empty',
          isEmpty: true,
        };
      }
    }
  }

  async getCurrentBranch(repoPath: string): Promise<string> {
    const git = simpleGit(repoPath);
    try {
      // An unborn branch has a symbolic HEAD but is absent from `git branch`.
      const branch = (await git.raw(['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim();
      if (branch) return branch;
    } catch {
      // `symbolic-ref --quiet` exits unsuccessfully for a detached checkout.
    }
    // Only a valid detached checkout should use the HEAD label.
    await git.revparse(['--verify', 'HEAD']);
    return 'HEAD';
  }

  async listBranches(repoPath: string): Promise<string[]> {
    const branchSummary = await simpleGit(repoPath).branchLocal();
    return branchSummary.all;
  }
}
