import type { RepositoryContext } from '../repository-context.js';
import type { ReviewFile } from '../utils.js';
export type RepositoryInfo = Pick<
  RepositoryContext,
  'selectedPath' | 'isGitRepo' | 'repoRoot' | 'workdirPrefix'
>;

export interface BaseRefInfo {
  ref: string;
  commit: string;
  isEmpty: boolean;
}

export interface ListedWorktree {
  path: string;
  branch: string;
}

export interface WorktreeResult {
  path: string;
  workspacePath: string;
  branch: string;
  baseCommit: string;
}

export interface Workspace {
  readonly path: string;
  readonly branch: string;
  readonly baseCommit: string;

  getDiff(): Promise<string>;
  getReviewFiles(): Promise<ReviewFile[]>;
  stageFile(filePath: string): Promise<void>;
  revertFile(filePath: string): Promise<void>;
}

export interface WorkspaceStorage {
  baseDir: string;
}
