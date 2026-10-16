import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitPullRequest, CreatePullRequestResult } from '@agentctl/shared';
import type { PullRequestHost, PullRequestInput } from './types.js';

const execFileAsync = promisify(execFile);

export function parseGitHubRemoteUrl(remoteUrl: string): string | null {
  const remote = remoteUrl.trim();
  const scp = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(remote);
  if (scp) return `https://github.com/${scp[1]}/${scp[2]}`;
  try {
    const url = new URL(remote);
    if (
      url.hostname.toLowerCase() !== 'github.com' ||
      !['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol)
    )
      return null;
    const match = /^\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.pathname);
    return match ? `https://github.com/${match[1]}/${match[2]}` : null;
  } catch {
    return null;
  }
}

export class GitHubPullRequests implements PullRequestHost {
  async find(
    worktreePath: string,
    branch: string,
    repositoryUrl?: string,
  ): Promise<GitPullRequest | null> {
    try {
      if (!branch) return null;

      const { stdout } = await execFileAsync(
        'gh',
        [
          'pr',
          'view',
          branch,
          ...(repositoryUrl ? ['--repo', repositoryUrl] : []),
          '--json',
          'number,title,url,state,headRefName,baseRefName',
        ],
        { cwd: worktreePath, timeout: 5000 },
      );
      const data = JSON.parse(stdout) as {
        number?: number;
        title?: string;
        url?: string;
        state?: string;
        headRefName?: string;
        baseRefName?: string;
      };
      if (!data.number || !data.url) return null;

      const stateMap: Record<string, 'open' | 'closed' | 'merged'> = {
        OPEN: 'open',
        CLOSED: 'closed',
        MERGED: 'merged',
      };

      return {
        number: data.number,
        title: data.title ?? '',
        url: data.url,
        baseBranch: data.baseRefName ?? 'main',
        headBranch: data.headRefName ?? branch,
        state: stateMap[data.state ?? 'OPEN'] ?? 'open',
      };
    } catch {
      return null;
    }
  }

  async create(
    worktreePath: string,
    repositoryUrl: string,
    input: PullRequestInput,
  ): Promise<CreatePullRequestResult> {
    const { base, head } = input;
    try {
      const args = [
        'pr',
        'create',
        '--repo',
        repositoryUrl,
        '--title',
        input.title,
        '--base',
        base,
        '--head',
        head,
      ];
      if (input.body) {
        args.push('--body', input.body);
      }
      const { stdout } = await execFileAsync('gh', args, {
        cwd: worktreePath,
        timeout: 15000,
      });

      const prUrl = stdout.trim().split('\n').pop()?.trim() ?? '';
      const prNumberMatch = /\/pull\/(\d+)/.exec(prUrl);
      if (!prNumberMatch) {
        throw new Error('GitHub CLI did not return a pull request URL');
      }
      const prNumber = parseInt(prNumberMatch[1], 10);

      return {
        status: 'created',
        pr: {
          number: prNumber,
          title: input.title,
          url: prUrl,
          baseBranch: base,
          headBranch: head,
          state: 'open',
        },
      };
    } catch {
      const query = new URLSearchParams({
        expand: '1',
        title: input.title,
        ...(input.body ? { body: input.body } : {}),
      });
      return {
        status: 'needs_browser',
        compareUrl: `${repositoryUrl}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?${query.toString()}`,
      };
    }
  }
}
