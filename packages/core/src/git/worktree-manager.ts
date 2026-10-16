import type { GitMutex } from './mutex.js';
import type { PullRequestHost } from '../forge/types.js';
import { createGitCapabilities, type GitCapabilities } from './composition.js';
import type { Workspace } from './capabilities/types.js';
export type {
  RepositoryInfo,
  BaseRefInfo,
  WorktreeResult,
  Workspace,
  ListedWorktree,
} from './capabilities/types.js';
export { parsePorcelainWorktrees } from './capabilities/worktree-lifecycle.js';
export { parseGitHubRemoteUrl } from '../forge/github-pull-requests.js';
/** Compatibility facade. Implementations and state belong to focused capabilities. */
export class WorkspaceManager {
  readonly capabilities: GitCapabilities;
  constructor(
    private readonly gitMutex: GitMutex,
    baseDir?: string,
    pullRequests?: PullRequestHost,
  ) {
    this.capabilities = createGitCapabilities(gitMutex, baseDir, pullRequests);
  }
  setBaseDir(dir: string): void {
    this.capabilities.setBaseDir(dir);
  }
  resolveRepository(
    ...args: Parameters<GitCapabilities['queries']['resolveRepository']>
  ): ReturnType<GitCapabilities['queries']['resolveRepository']> {
    return this.capabilities.queries.resolveRepository(...args);
  }
  resolveBaseRef(
    ...args: Parameters<GitCapabilities['queries']['resolveBaseRef']>
  ): ReturnType<GitCapabilities['queries']['resolveBaseRef']> {
    return this.capabilities.queries.resolveBaseRef(...args);
  }
  getCurrentBranch(
    ...args: Parameters<GitCapabilities['queries']['getCurrentBranch']>
  ): ReturnType<GitCapabilities['queries']['getCurrentBranch']> {
    return this.capabilities.queries.getCurrentBranch(...args);
  }
  listBranches(
    ...args: Parameters<GitCapabilities['queries']['listBranches']>
  ): ReturnType<GitCapabilities['queries']['listBranches']> {
    return this.capabilities.queries.listBranches(...args);
  }
  getActiveBranchesInWorktrees(
    ...args: Parameters<GitCapabilities['worktrees']['getActiveBranchesInWorktrees']>
  ): ReturnType<GitCapabilities['worktrees']['getActiveBranchesInWorktrees']> {
    return this.capabilities.worktrees.getActiveBranchesInWorktrees(...args);
  }
  create(
    ...args: Parameters<GitCapabilities['worktrees']['create']>
  ): ReturnType<GitCapabilities['worktrees']['create']> {
    return this.capabilities.worktrees.create(...args);
  }
  restore(
    ...args: Parameters<GitCapabilities['worktrees']['restore']>
  ): ReturnType<GitCapabilities['worktrees']['restore']> {
    return this.capabilities.worktrees.restore(...args);
  }
  listOrphans(
    ...args: Parameters<GitCapabilities['worktrees']['listOrphans']>
  ): ReturnType<GitCapabilities['worktrees']['listOrphans']> {
    return this.capabilities.worktrees.listOrphans(...args);
  }
  addBranchWorktree(
    ...args: Parameters<GitCapabilities['worktrees']['addBranchWorktree']>
  ): ReturnType<GitCapabilities['worktrees']['addBranchWorktree']> {
    return this.capabilities.worktrees.addBranchWorktree(...args);
  }
  cleanup(
    ...args: Parameters<GitCapabilities['worktrees']['cleanup']>
  ): ReturnType<GitCapabilities['worktrees']['cleanup']> {
    return this.capabilities.worktrees.cleanup(...args);
  }
  removeWorktreeOnly(
    ...args: Parameters<GitCapabilities['worktrees']['removeWorktreeOnly']>
  ): ReturnType<GitCapabilities['worktrees']['removeWorktreeOnly']> {
    return this.capabilities.worktrees.removeWorktreeOnly(...args);
  }
  sync(
    ...args: Parameters<GitCapabilities['worktrees']['sync']>
  ): ReturnType<GitCapabilities['worktrees']['sync']> {
    return this.capabilities.worktrees.sync(...args);
  }
  isCleanWorkspace(
    ...args: Parameters<GitCapabilities['workingCopy']['isCleanWorkspace']>
  ): ReturnType<GitCapabilities['workingCopy']['isCleanWorkspace']> {
    return this.capabilities.workingCopy.isCleanWorkspace(...args);
  }
  stageFile(
    ...args: Parameters<GitCapabilities['workingCopy']['stageFile']>
  ): ReturnType<GitCapabilities['workingCopy']['stageFile']> {
    return this.capabilities.workingCopy.stageFile(...args);
  }
  revertFile(
    ...args: Parameters<GitCapabilities['workingCopy']['revertFile']>
  ): ReturnType<GitCapabilities['workingCopy']['revertFile']> {
    return this.capabilities.workingCopy.revertFile(...args);
  }
  stageAll(
    ...args: Parameters<GitCapabilities['workingCopy']['stageAll']>
  ): ReturnType<GitCapabilities['workingCopy']['stageAll']> {
    return this.capabilities.workingCopy.stageAll(...args);
  }
  unstageFile(
    ...args: Parameters<GitCapabilities['workingCopy']['unstageFile']>
  ): ReturnType<GitCapabilities['workingCopy']['unstageFile']> {
    return this.capabilities.workingCopy.unstageFile(...args);
  }
  unstagePaths(
    ...args: Parameters<GitCapabilities['workingCopy']['unstagePaths']>
  ): ReturnType<GitCapabilities['workingCopy']['unstagePaths']> {
    return this.capabilities.workingCopy.unstagePaths(...args);
  }
  unstageAll(
    ...args: Parameters<GitCapabilities['workingCopy']['unstageAll']>
  ): ReturnType<GitCapabilities['workingCopy']['unstageAll']> {
    return this.capabilities.workingCopy.unstageAll(...args);
  }
  commit(
    ...args: Parameters<GitCapabilities['workingCopy']['commit']>
  ): ReturnType<GitCapabilities['workingCopy']['commit']> {
    return this.capabilities.workingCopy.commit(...args);
  }
  checkout(
    ...args: Parameters<GitCapabilities['integration']['checkout']>
  ): ReturnType<GitCapabilities['integration']['checkout']> {
    return this.capabilities.integration.checkout(...args);
  }
  createBranch(
    ...args: Parameters<GitCapabilities['integration']['createBranch']>
  ): ReturnType<GitCapabilities['integration']['createBranch']> {
    return this.capabilities.integration.createBranch(...args);
  }
  getMergePreview(
    ...args: Parameters<GitCapabilities['integration']['getMergePreview']>
  ): ReturnType<GitCapabilities['integration']['getMergePreview']> {
    return this.capabilities.integration.getMergePreview(...args);
  }
  finalize(
    ...args: Parameters<GitCapabilities['integration']['finalize']>
  ): ReturnType<GitCapabilities['integration']['finalize']> {
    return this.capabilities.integration.finalize(...args);
  }
  refreshBranch(
    ...args: Parameters<GitCapabilities['integration']['refreshBranch']>
  ): ReturnType<GitCapabilities['integration']['refreshBranch']> {
    return this.capabilities.integration.refreshBranch(...args);
  }
  merge(
    ...args: Parameters<GitCapabilities['integration']['merge']>
  ): ReturnType<GitCapabilities['integration']['merge']> {
    return this.capabilities.integration.merge(...args);
  }
  checkMergeConflicts(
    ...args: Parameters<GitCapabilities['integration']['checkMergeConflicts']>
  ): ReturnType<GitCapabilities['integration']['checkMergeConflicts']> {
    return this.capabilities.integration.checkMergeConflicts(...args);
  }
  fetch(
    ...args: Parameters<GitCapabilities['remotes']['fetch']>
  ): ReturnType<GitCapabilities['remotes']['fetch']> {
    return this.capabilities.remotes.fetch(...args);
  }
  push(
    ...args: Parameters<GitCapabilities['remotes']['push']>
  ): ReturnType<GitCapabilities['remotes']['push']> {
    return this.capabilities.remotes.push(...args);
  }
  pull(
    ...args: Parameters<GitCapabilities['remotes']['pull']>
  ): ReturnType<GitCapabilities['remotes']['pull']> {
    return this.capabilities.remotes.pull(...args);
  }
  getTrackingStatus(
    ...args: Parameters<GitCapabilities['remotes']['getTrackingStatus']>
  ): ReturnType<GitCapabilities['remotes']['getTrackingStatus']> {
    return this.capabilities.remotes.getTrackingStatus(...args);
  }
  detectPullRequest(
    ...args: Parameters<GitCapabilities['pullRequests']['detectPullRequest']>
  ): ReturnType<GitCapabilities['pullRequests']['detectPullRequest']> {
    return this.capabilities.pullRequests.detectPullRequest(...args);
  }
  createPullRequest(
    ...args: Parameters<GitCapabilities['pullRequests']['createPullRequest']>
  ): ReturnType<GitCapabilities['pullRequests']['createPullRequest']> {
    return this.capabilities.pullRequests.createPullRequest(...args);
  }
  getDiff(
    ...args: Parameters<GitCapabilities['review']['getDiff']>
  ): ReturnType<GitCapabilities['review']['getDiff']> {
    return this.capabilities.review.getDiff(...args);
  }
  getReviewFiles(
    ...args: Parameters<GitCapabilities['review']['getReviewFiles']>
  ): ReturnType<GitCapabilities['review']['getReviewFiles']> {
    return this.capabilities.review.getReviewFiles(...args);
  }
  async withRepositoryLock<T>(repoPath: string, task: () => Promise<T>): Promise<T> {
    return this.gitMutex.run(repoPath, task);
  }

  getWorkspace(
    repoPath: string,
    sessionId: string,
    taskSlug: string,
    worktreePath: string,
    baseCommit: string,
    branch: string,
  ): Workspace {
    return {
      path: worktreePath,
      branch,
      baseCommit,
      getDiff: async () => {
        return this.getDiff(repoPath, worktreePath, baseCommit);
      },
      getReviewFiles: async () => {
        return this.getReviewFiles(repoPath, worktreePath, baseCommit);
      },
      stageFile: async (filePath: string) => {
        return this.stageFile(repoPath, worktreePath, filePath);
      },
      revertFile: async (filePath: string) => {
        return this.revertFile(repoPath, worktreePath, filePath);
      },
    };
  }
}
export { WorkspaceManager as WorktreeManager };
export type { Workspace as WorkspaceHandle };
