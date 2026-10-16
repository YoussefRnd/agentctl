import fs from 'node:fs/promises';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { resolveRepositoryContext } from './repository-context.js';
import { SnapshotService } from './snapshot-service.js';
import { RepositoryError } from '../repository/errors.js';
import { repositoryIdentity } from '../repository/identity.js';
import type { RepositoryBackend, BackendWorkspace } from '../repository/types.js';

function immutableRevision(id: string): string {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(id))
    throw new RepositoryError('invalid_revision', 'Invalid Git revision reference');
  return id;
}

export class GitRepositoryBackend implements RepositoryBackend {
  readonly id = 'git';

  constructor(private readonly snapshots: SnapshotService) {}

  async open(workspacePath: string): Promise<BackendWorkspace | null> {
    const context = await resolveRepositoryContext(workspacePath);
    if (!context.isGitRepo) return null;
    const common = (await simpleGit(workspacePath).revparse(['--git-common-dir'])).trim();
    const commonDir = await fs.realpath(path.resolve(workspacePath, common));
    return {
      identity: {
        repositoryId: repositoryIdentity(this.id, commonDir),
        workspaceId: repositoryIdentity(this.id, context.gitDir),
        workspacePath: context.selectedPath,
        rootPath: context.repoRoot,
        scope: context.workdirPrefix,
      },
      resolveRevision: (selector) => this.snapshots.resolveRevision(workspacePath, selector),
      capture: async () => {
        const revision = await this.snapshots.track(workspacePath);
        if (!revision) throw new Error('Repository is no longer available');
        return revision;
      },
      review: async (baseline, options) => {
        const result = await this.snapshots.getReview(
          workspacePath,
          baseline === undefined ? 'none' : immutableRevision(baseline),
          options,
        );
        return {
          files: result.files,
          ...(result.capture
            ? {
                capture: {
                  current: result.capture.currentTree,
                  working: result.capture.workingTree,
                  baseline: result.capture.sessionTree,
                },
              }
            : {}),
        };
      },
      compare: (from, to) =>
        this.snapshots.compareSnapshots(
          workspacePath,
          immutableRevision(from),
          immutableRevision(to),
        ),
      diff: (from, to, filePath) =>
        this.snapshots.getCheckpointDiffFiles(
          workspacePath,
          immutableRevision(from),
          immutableRevision(to),
          filePath,
        ),
      restore: async (revision) => {
        const result = await this.snapshots.restoreFiles(
          workspacePath,
          immutableRevision(revision),
        );
        return { backup: result.backupHash, restoredFiles: result.restoredFiles };
      },
    };
  }
}
