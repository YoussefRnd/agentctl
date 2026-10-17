import { WorkspaceIndex } from './workspace-index.js';
import {
  readContextFile,
  resolveContextPath,
  scanDirectory,
  MAX_FILE_SIZE_BYTES,
} from './context-files.js';
import { resolveGitContext } from './git-context.js';
import { fuzzySearch } from '@agentctl/shared';
import path from 'node:path';

import type {
  ContextItem,
  ContextItemType,
  ContextItemReference,
  ResolvedContextResult,
} from './types.js';
export type {
  ContextItem,
  ContextItemType,
  ContextItemReference,
  ResolvedContextResult,
} from './types.js';
export class ContextService {
  private readonly index = new WorkspaceIndex();

  /**
   * Search workspace files, folders, git targets, and symbols
   */
  async search(
    workspacePath: string,
    query = '',
    filterType: 'all' | ContextItemType = 'all',
  ): Promise<ContextItem[]> {
    const q = query.trim().toLowerCase();
    const results: ContextItem[] = [];

    // 1. Add Git context actions
    if (filterType === 'all' || filterType === 'git') {
      const gitItems: ContextItem[] = [
        {
          id: 'git:diff',
          type: 'git',
          title: 'Git Diff (Working Tree)',
          subtitle: 'Unstaged and staged code modifications',
          value: 'diff',
        },
        {
          id: 'git:staged',
          type: 'git',
          title: 'Git Staged Changes',
          subtitle: 'Changes staged for commit (git diff --cached)',
          value: 'staged',
        },
        {
          id: 'git:status',
          type: 'git',
          title: 'Git Status',
          subtitle: 'Summary of changed and untracked files',
          value: 'status',
        },
        {
          id: 'git:log',
          type: 'git',
          title: 'Recent Commits',
          subtitle: 'Last 5 commits in current branch',
          value: 'log',
        },
      ];

      for (const item of gitItems) {
        results.push(item);
      }
    }

    // 2. Scan workspace files via Git (or filesystem fallback)
    if (filterType === 'all' || filterType === 'file' || filterType === 'folder') {
      try {
        const items = await this.index.get(workspacePath);
        for (const item of items) {
          if (filterType === 'all' || item.type === filterType) results.push(item);
        }
      } catch {
        // Workspace read error
      }
    }

    return fuzzySearch(
      results,
      q,
      (item) => [item.title, item.subtitle, item.type === 'git' ? item.id : undefined],
      50,
    );
  }

  /**
   * Resolve selected context items into a single structured prompt attachment payload
   */
  async resolve(
    workspacePath: string,
    items: ContextItemReference[],
  ): Promise<ResolvedContextResult> {
    const formattedBlocks: string[] = [];
    const resolvedItems: Array<{ id: string; type: ContextItemType; title: string; size: number }> =
      [];

    for (const item of items) {
      if (item.type === 'file') {
        const filePath = item.path || item.value;
        try {
          const file = await readContextFile(workspacePath, filePath);
          if (!file) continue;
          const { content, truncated: isTruncated, size: originalLength } = file;

          const ext = path.extname(filePath).replace('.', '') || 'txt';
          formattedBlocks.push(
            `### Context Attachment: \`${filePath}\`\n\`\`\`${ext}\n${content}${
              isTruncated ? `\n... [Truncated: File exceeds ${MAX_FILE_SIZE_BYTES} bytes]` : ''
            }\n\`\`\``,
          );

          resolvedItems.push({
            id: `file:${filePath}`,
            type: 'file',
            title: path.basename(filePath),
            size: originalLength,
          });
        } catch {
          // File not readable
        }
      } else if (item.type === 'git') {
        const resolved = await resolveGitContext(workspacePath, item);
        if (resolved.formattedContent) formattedBlocks.push(resolved.formattedContent);
        resolvedItems.push(...resolved.items);
      } else if (item.type === 'folder') {
        const folderPath = item.path || item.value;
        try {
          const fullPath = resolveContextPath(workspacePath, folderPath);
          const files = await scanDirectory(fullPath);
          const relativeList = files.map((f) => path.join(folderPath, f));
          const summary = `Directory \`${folderPath}/\` contains ${relativeList.length} files:\n${relativeList
            .slice(0, 30)
            .map((f) => `- ${f}`)
            .join(
              '\n',
            )}${relativeList.length > 30 ? `\n... and ${relativeList.length - 30} more files` : ''}`;

          formattedBlocks.push(`### Context Attachment: Folder \`${folderPath}/\`\n${summary}`);
          resolvedItems.push({
            id: `folder:${folderPath}`,
            type: 'folder',
            title: path.basename(folderPath),
            size: summary.length,
          });
        } catch {
          // Folder not readable
        }
      }
    }

    return {
      formattedContent: formattedBlocks.join('\n\n'),
      items: resolvedItems,
    };
  }
}
