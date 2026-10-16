import { simpleGit } from 'simple-git';
import type { GitRepositoryQueries } from './repository-queries.js';
export async function trackingTarget(
  queries: Pick<GitRepositoryQueries, 'getCurrentBranch'>,
  worktreePath: string,
): Promise<{ branch: string; remote: string; ref: string; configured: boolean }> {
  const git = simpleGit(worktreePath);
  const branch = await queries.getCurrentBranch(worktreePath);
  if (!branch || branch === 'HEAD') throw new Error('Check out a branch before synchronizing');
  const configuredRemote = (
    await git.raw(['config', '--get', `branch.${branch}.remote`]).catch(() => '')
  ).trim();
  const configuredRef = (
    await git.raw(['config', '--get', `branch.${branch}.merge`]).catch(() => '')
  ).trim();
  if (configuredRemote && configuredRef)
    return { branch, remote: configuredRemote, ref: configuredRef, configured: true };
  const remotes = await git.getRemotes();
  const remote = remotes.find((r) => r.name === 'origin') ?? remotes[0];
  if (!remote) throw new Error('No Git remote is configured for this repository');
  return { branch, remote: remote.name, ref: `refs/heads/${branch}`, configured: false };
}
