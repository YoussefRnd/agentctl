import fs from 'node:fs/promises';
import path from 'node:path';
import { simpleGit } from 'simple-git';
export async function assertNoGitOperation(
  worktreePath: string,
  allowMergeHead = false,
): Promise<void> {
  const git = simpleGit(worktreePath);
  for (const marker of [
    'MERGE_HEAD',
    'CHERRY_PICK_HEAD',
    'REVERT_HEAD',
    'rebase-merge',
    'rebase-apply',
  ]) {
    if (allowMergeHead && marker === 'MERGE_HEAD') continue;
    const markerPath = (await git.raw(['rev-parse', '--git-path', marker])).trim();
    if (
      await fs
        .access(path.resolve(worktreePath, markerPath))
        .then(() => true)
        .catch(() => false)
    ) {
      throw new Error(`Finish or abort the Git operation in ${worktreePath} before merging.`);
    }
  }
}

export async function assertIgnoredFilesSafe(
  worktreePath: string,
  incomingRef: string,
): Promise<void> {
  const root = (await simpleGit(worktreePath).revparse(['--show-toplevel'])).trim();
  const git = simpleGit(root);
  const ignored = (await git.raw(['ls-files', '--others', '--ignored', '--exclude-standard', '-z']))
    .split('\0')
    .filter(Boolean);
  if (!ignored.length) return;
  const incoming = new Set(
    (await git.raw(['ls-tree', '-r', '--name-only', '-z', incomingRef]))
      .split('\0')
      .filter(Boolean),
  );
  const directories = new Set<string>();
  for (const file of incoming) {
    let index = file.indexOf('/');
    while (index !== -1) {
      directories.add(file.slice(0, index));
      index = file.indexOf('/', index + 1);
    }
  }
  for (const file of ignored) {
    let collision = incoming.has(file) || directories.has(file);
    let index = file.indexOf('/');
    while (!collision && index !== -1) {
      collision = incoming.has(file.slice(0, index));
      index = file.indexOf('/', index + 1);
    }
    if (collision)
      throw new Error(
        `The merge would overwrite ignored file ${file} in ${root}. Move or rename it, then retry. Your files have been kept.`,
      );
  }
}
