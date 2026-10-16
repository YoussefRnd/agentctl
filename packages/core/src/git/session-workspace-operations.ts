import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import type {
  WorkspaceBinding,
  WorkspaceIntegration,
  WorkspaceLifecycle,
} from '../repository/workspace.js';
import type { WorkspaceManager } from './worktree-manager.js';
import type { SnapshotService } from './snapshot-service.js';
import type { RepositoryContext } from './repository-context.js';

type GitWorkspacePorts = Pick<
  WorkspaceManager,
  | 'resolveBaseRef'
  | 'create'
  | 'restore'
  | 'isCleanWorkspace'
  | 'removeWorktreeOnly'
  | 'cleanup'
  | 'sync'
  | 'getMergePreview'
  | 'finalize'
  | 'withRepositoryLock'
  | 'unstagePaths'
>;

/** Git policy and recovery state stay behind the repository/workspace boundary. */
export class GitSessionWorkspaceOperations implements WorkspaceLifecycle, WorkspaceIntegration {
  constructor(
    private readonly projectPath: string,
    private readonly context: Extract<RepositoryContext, { isGitRepo: true }>,
    private readonly git: GitWorkspacePorts,
    private readonly snapshots: SnapshotService,
  ) {}
  async allocate(input: { sessionId: string; title: string; target?: string }) {
    const base = await this.git.resolveBaseRef(this.context.repoRoot, input.target ?? 'main');
    if (base.isEmpty) return null;
    const worktree = await this.git.create(
      this.context.repoRoot,
      input.sessionId,
      input.title,
      base.ref,
      this.context.workdirPrefix,
    );
    return {
      path: worktree.workspacePath,
      label: worktree.branch,
      baseline: worktree.baseCommit,
      target: base.ref,
    };
  }
  async restore(binding: WorkspaceBinding, allowRecreate: boolean) {
    if (!binding.baseline) throw new Error('Missing workspace baseline');
    await this.git.restore(
      this.context.repoRoot,
      binding.label,
      binding.path,
      binding.baseline,
      this.context.workdirPrefix,
      allowRecreate,
    );
  }
  async retire(binding: WorkspaceBinding, keepChanges = false) {
    if (keepChanges) {
      if (!(await this.git.isCleanWorkspace(this.context.repoRoot, binding.path)))
        throw new Error('Commit or discard changes before switching workspace mode');
      await this.git.removeWorktreeOnly(this.context.repoRoot, binding.path);
    } else await this.git.cleanup(this.context.repoRoot, binding.path, binding.label);
  }
  async sync(activeIds: string[], knownIds: string[]) {
    await this.git.sync(this.context.repoRoot, activeIds, knownIds);
  }
  async preview(binding: WorkspaceBinding, target: string) {
    return this.git.getMergePreview(this.context.repoRoot, binding.path, binding.label, target);
  }
  async apply(binding: WorkspaceBinding, options: { message: string; target?: string }) {
    if (binding.isolated) {
      await this.git.finalize(
        this.context.repoRoot,
        binding.path,
        binding.label,
        options.target ?? binding.target ?? 'main',
        'merge',
        options.message,
        options.message,
      );
      return;
    }
    await this.git.withRepositoryLock(this.context.repoRoot, async () => {
      const userGit = simpleGit(binding.path);
      if (!binding.baseline) {
        if (!(await userGit.status()).isClean())
          throw new Error(
            'Git was initialized after this session started. Commit the workspace changes before applying the session.',
          );
        await userGit.revparse(['--verify', 'HEAD']);
        return;
      }
      const patches = await this.snapshots.diff(binding.path, binding.baseline);
      if (!patches.length) return;
      if ((await userGit.status()).conflicted.length)
        throw new Error('Resolve conflicts before applying');
      const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-apply-'));
      try {
        const git = simpleGit({
          baseDir: binding.path,
          timeout: { block: 120000, stdErr: false, stdOut: false },
        }).env('GIT_INDEX_FILE', path.join(temporary, 'index'));
        const hasHead = await userGit
          .revparse(['--verify', 'HEAD'])
          .then(() => true)
          .catch(() => false);
        await git.raw(hasHead ? ['read-tree', 'HEAD'] : ['read-tree', '--empty']);
        const paths = patches.map((patch) => patch.path);
        await git.raw(['--literal-pathspecs', 'add', '-A', '--', ...paths]);
        if (!(await git.diff(['--cached', '--name-only'])).trim()) return;
        const before = (await userGit.revparse(['HEAD']).catch(() => '')).trim();
        await git.commit(options.message);
        const after = (await userGit.revparse(['HEAD']).catch(() => '')).trim();
        if (after === before)
          throw new Error('Git did not create the Apply commit. Check your commit hooks.');
        await this.git.unstagePaths(binding.path, paths);
      } finally {
        await fs.rm(temporary, { recursive: true, force: true });
      }
    });
  }
  async discard(binding: WorkspaceBinding): Promise<string> {
    if (binding.isolated) return JSON.stringify({ worktree: true });
    return this.git.withRepositoryLock(this.context.repoRoot, async () => {
      if (!binding.baseline) throw new Error('No checkpoint is available for workspace discard');
      const snapshotHash = await this.snapshots.track(binding.path);
      if (!snapshotHash) throw new Error('Repository is no longer available');
      const git = simpleGit(binding.path);
      const indexTree = (await git.raw(['write-tree'])).trim();
      await git.raw(['update-ref', `refs/agentctl/discard-index/${binding.sessionId}`, indexTree]);
      const headCommit = (await git.revparse(['HEAD']).catch(() => '')).trim();
      const patches = await this.snapshots.diff(binding.path, binding.baseline);
      await this.snapshots.revertFiles(binding.path, binding.baseline, patches);
      if (patches.length)
        await this.git.unstagePaths(
          binding.path,
          patches.map((patch) => patch.path),
        );
      const postSnapshotHash = await this.snapshots.track(binding.path);
      const postIndexTree = (await git.raw(['write-tree'])).trim();
      return JSON.stringify({
        snapshotHash,
        indexTree,
        headCommit,
        postSnapshotHash,
        postIndexTree,
      });
    });
  }
  async undoDiscard(binding: WorkspaceBinding, recovery: string) {
    await this.git.withRepositoryLock(this.context.repoRoot, async () => {
      if (binding.isolated) {
        if (!(await fs.stat(binding.path).catch(() => null))?.isDirectory())
          throw new Error('The retained workspace is missing');
      } else {
        const backup = JSON.parse(recovery) as {
          snapshotHash: string;
          indexTree: string;
          headCommit: string;
          postSnapshotHash: string;
          postIndexTree: string;
        };
        const git = simpleGit(binding.path);
        const head = (await git.revparse(['HEAD']).catch(() => '')).trim();
        const index = (await git.raw(['write-tree'])).trim();
        const current = await this.snapshots.track(binding.path);
        if (
          head !== backup.headCommit ||
          index !== backup.postIndexTree ||
          current !== backup.postSnapshotHash
        )
          throw new Error(
            'Workspace changed after discard. Preserve those changes before recovering.',
          );
        await this.snapshots.restoreFiles(binding.path, backup.snapshotHash);
        await git.raw(['read-tree', backup.indexTree]);
      }
    });
  }
  async forgetRecovery(sessionId: string) {
    await simpleGit(this.projectPath).raw([
      'update-ref',
      '-d',
      `refs/agentctl/discard-index/${sessionId}`,
    ]);
  }
}
