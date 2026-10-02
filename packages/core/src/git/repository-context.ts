import fs from 'node:fs/promises';
import path from 'node:path';
import { simpleGit } from 'simple-git';

export type RepositoryContext = {
  selectedPath: string;
  workdirPrefix: string;
} & (
  | { isGitRepo: false; repoRoot: null; gitDir: null; indexPath: null }
  | { isGitRepo: true; repoRoot: string; gitDir: string; indexPath: string }
);

/** Resolve a project through Git itself, including symlinks and linked worktrees. */
export async function resolveRepositoryContext(selectedPath: string): Promise<RepositoryContext> {
  const stats = await fs.stat(selectedPath);
  if (!stats.isDirectory()) throw new Error('Selected path is not a directory');
  const canonicalPath = await fs.realpath(selectedPath);
  const git = simpleGit(canonicalPath);
  if (!(await git.checkIsRepo().catch(() => false))) {
    return {
      selectedPath: canonicalPath,
      isGitRepo: false,
      repoRoot: null,
      workdirPrefix: '',
      gitDir: null,
      indexPath: null,
    };
  }
  const [root, directory] = await Promise.all([
    git.revparse(['--show-toplevel']),
    git.revparse(['--git-dir']),
  ]);
  const [repoRoot, gitDir] = await Promise.all([
    fs.realpath(root.trim()),
    fs.realpath(path.resolve(canonicalPath, directory.trim())),
  ]);
  const prefix = path.relative(repoRoot, canonicalPath);
  if (prefix === '..' || prefix.startsWith(`..${path.sep}`) || path.isAbsolute(prefix)) {
    throw new Error('Project path resolves outside its Git worktree');
  }
  return {
    selectedPath: canonicalPath,
    isGitRepo: true,
    repoRoot,
    workdirPrefix: prefix.split(path.sep).join('/'),
    gitDir,
    indexPath: path.join(gitDir, 'index'),
  };
}
