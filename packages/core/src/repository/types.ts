import type { WorkspaceLifecycle, WorkspaceIntegration } from './workspace.js';
import type {
  ReviewDiffScope,
  ReviewFile,
  SourceRepositoryInfo,
  RevisionReference,
} from '@agentctl/shared';

export interface FileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  additions: number;
  deletions: number;
}

export interface ChangeComparison {
  files: FileChange[];
  totalAdditions: number;
  totalDeletions: number;
}

export interface RepositoryRestore {
  backup: RevisionReference;
  restoredFiles: FileChange[];
}

export interface RepositoryReviewOptions {
  includeDiffs?: boolean;
  filePath?: string;
  scope?: ReviewDiffScope;
}

/** Backend-native revision IDs stay on this side of the service boundary. */
export interface BackendReview {
  files: ReviewFile[];
  capture?: { current: string; working: string; baseline: string };
}

export interface BackendWorkspace {
  identity: Omit<SourceRepositoryInfo, 'backendId' | 'capabilities'>;
  legacyProjectMetadata?: { repoRoot: string; subdir: string };
  lifecycle?: WorkspaceLifecycle;
  integration?: WorkspaceIntegration;
  localLabel?: () => Promise<string>;
  stageFile?: (filePath: string) => Promise<void>;
  revertFiles?: (revision: string, paths: string[]) => Promise<void>;
  cleanup?: () => Promise<void>;
  importLegacyRevision?: (selector: string) => Promise<string>;
  importLegacyRecovery?: (recovery: string) => string;
  resolveRevision?: (selector: string) => Promise<string>;
  capture?: () => Promise<string>;
  textSnapshot?: (revision: string) => Promise<RepositoryTextSnapshot>;
  review?: (
    baseline: string | undefined,
    options: RepositoryReviewOptions,
  ) => Promise<BackendReview>;
  compare?: (from: string, to: string) => Promise<ChangeComparison>;
  diff?: (from: string, to: string, filePath?: string) => Promise<ReviewFile[]>;
  restore?: (revision: string) => Promise<{ backup: string; restoredFiles: FileChange[] }>;
}

export interface RepositoryBackend {
  readonly id: string;
  /** Return null only when this backend does not own the selected directory. */
  open(workspacePath: string): Promise<BackendWorkspace | null>;
}

/** Read-only access to one immutable revision; never follows working-tree links. */
export interface SnapshotFileEntry {
  path: string;
  size: number;
  kind: 'file' | 'symlink' | 'submodule';
}
export type SnapshotTextFile =
  | { status: 'text'; text: string }
  | { status: 'missing' | 'binary' | 'too_large' | 'symlink' | 'submodule' };
export interface RepositoryTextSnapshot {
  listFiles(
    limit: number,
    signal?: AbortSignal,
  ): Promise<{ files: SnapshotFileEntry[]; truncated: boolean }>;
  readFile(path: string, maxBytes: number, signal?: AbortSignal): Promise<SnapshotTextFile>;
  search?(
    terms: string[],
    limit: number,
    signal?: AbortSignal,
  ): Promise<{ paths: string[]; truncated: boolean }>;
}
