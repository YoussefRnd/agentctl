import { simpleGit } from 'simple-git';
import type { ContextItemReference, ResolvedContextResult } from './types.js';

export async function resolveGitContext(
  workspacePath: string,
  item: ContextItemReference,
): Promise<ResolvedContextResult> {
  const git = simpleGit(workspacePath);
  const formattedBlocks: string[] = [];
  const resolvedItems: ResolvedContextResult['items'] = [];
  const target = item.target || item.value;
  try {
    if (target === 'diff') {
      const diff = await git.diff();
      const stagedDiff = await git.diff(['--cached']);
      const combined = [
        stagedDiff ? `# Staged Changes\n${stagedDiff}` : '',
        diff ? `# Unstaged Changes\n${diff}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');

      if (combined) {
        formattedBlocks.push(
          `### Context Attachment: Git Working Tree Diff\n\`\`\`diff\n${combined}\n\`\`\``,
        );
        resolvedItems.push({
          id: 'git:diff',
          type: 'git',
          title: 'Git Diff',
          size: combined.length,
        });
      }
    } else if (target === 'staged') {
      const stagedDiff = await git.diff(['--cached']);
      if (stagedDiff) {
        formattedBlocks.push(
          `### Context Attachment: Git Staged Changes\n\`\`\`diff\n${stagedDiff}\n\`\`\``,
        );
        resolvedItems.push({
          id: 'git:staged',
          type: 'git',
          title: 'Git Staged Diff',
          size: stagedDiff.length,
        });
      }
    } else if (target === 'status') {
      const status = await git.status();
      const statusText = [
        `On branch: ${status.current || 'detached'}`,
        status.staged.length > 0 ? `Staged files: ${status.staged.join(', ')}` : '',
        status.modified.length > 0 ? `Modified files: ${status.modified.join(', ')}` : '',
        status.not_added.length > 0 ? `Untracked files: ${status.not_added.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      formattedBlocks.push(`### Context Attachment: Git Status\n\`\`\`text\n${statusText}\n\`\`\``);
      resolvedItems.push({
        id: 'git:status',
        type: 'git',
        title: 'Git Status',
        size: statusText.length,
      });
    } else if (target === 'log') {
      const log = await git.log({ maxCount: 5 });
      const logText = log.all
        .map(
          (c: { hash: string; message: string; author_name: string }) =>
            `${c.hash.slice(0, 7)} - ${c.message} (${c.author_name})`,
        )
        .join('\n');

      formattedBlocks.push(
        `### Context Attachment: Recent Commits\n\`\`\`text\n${logText}\n\`\`\``,
      );
      resolvedItems.push({
        id: 'git:log',
        type: 'git',
        title: 'Recent Commits',
        size: logText.length,
      });
    }
  } catch {
    // Git operation failed
  }

  return { formattedContent: formattedBlocks.join('\n\n'), items: resolvedItems };
}

/** NUL delimiters preserve spaces, Unicode and newlines in Git file names. */
export async function listGitFiles(workspacePath: string): Promise<string[]> {
  const raw = await simpleGit(workspacePath).raw([
    'ls-files',
    '-z',
    '--cached',
    '--others',
    '--exclude-standard',
  ]);
  return [...new Set(raw.split('\0').filter(Boolean))];
}
