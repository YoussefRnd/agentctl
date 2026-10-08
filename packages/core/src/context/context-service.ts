import { fuzzySearch } from '@agentctl/shared';
import fs from 'node:fs/promises';
import path from 'node:path';
import { simpleGit } from 'simple-git';

export type ContextItemType = 'file' | 'folder' | 'git' | 'symbol';

export interface ContextItem {
  id: string;
  type: ContextItemType;
  title: string;
  subtitle: string;
  value: string;
  metadata?: Record<string, unknown>;
}

export interface ContextItemReference {
  type: ContextItemType;
  value: string;
  path?: string;
  target?: string;
}

export interface ResolvedContextResult {
  formattedContent: string;
  items: Array<{
    id: string;
    type: ContextItemType;
    title: string;
    size: number;
  }>;
}

const MAX_FILE_SIZE_BYTES = 48 * 1024; // 48KB maximum per attached file snippet
const CACHE_TTL_MS = 5000; // 5s workspace search index TTL cache
const MAX_CACHED_WORKSPACES = 20;

export class ContextService {
  private workspaceIndexCache = new Map<string, { items: ContextItem[]; cachedAt: number }>();
  private pendingIndexes = new Map<string, Promise<ContextItem[]>>();

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
        const items = await this.getWorkspaceIndex(workspacePath);
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

    const git = simpleGit(workspacePath);

    for (const item of items) {
      if (item.type === 'file') {
        const filePath = item.path || item.value;
        if (!this.isPathInsideWorkspace(workspacePath, filePath)) {
          continue;
        }
        const fullPath = path.resolve(workspacePath, filePath);

        try {
          const stats = await fs.stat(fullPath);
          if (!stats.isFile()) continue;

          let content = await fs.readFile(fullPath, 'utf-8');
          const originalLength = content.length;
          let isTruncated = false;

          if (content.length > MAX_FILE_SIZE_BYTES) {
            content = content.slice(0, MAX_FILE_SIZE_BYTES);
            isTruncated = true;
          }

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

            formattedBlocks.push(
              `### Context Attachment: Git Status\n\`\`\`text\n${statusText}\n\`\`\``,
            );
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
      } else if (item.type === 'folder') {
        const folderPath = item.path || item.value;
        if (!this.isPathInsideWorkspace(workspacePath, folderPath)) continue;
        const fullPath = path.resolve(workspacePath, folderPath);

        try {
          const files = await this.scanDirFallback(fullPath);
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

  private isPathInsideWorkspace(workspacePath: string, targetPath: string): boolean {
    const resolvedWorkspace = path.resolve(workspacePath);
    const resolvedTarget = path.resolve(workspacePath, targetPath);
    return (
      resolvedTarget === resolvedWorkspace ||
      resolvedTarget.startsWith(resolvedWorkspace + path.sep)
    );
  }

  private async getWorkspaceIndex(workspacePath: string): Promise<ContextItem[]> {
    const cached = this.workspaceIndexCache.get(workspacePath);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.items;
    const pending = this.pendingIndexes.get(workspacePath);
    if (pending) return pending;

    const build = this.buildWorkspaceIndex(workspacePath);
    this.pendingIndexes.set(workspacePath, build);
    try {
      const items = await build;
      if (this.workspaceIndexCache.size >= MAX_CACHED_WORKSPACES) {
        const oldest = this.workspaceIndexCache.keys().next().value;
        if (oldest !== undefined) this.workspaceIndexCache.delete(oldest);
      }
      this.workspaceIndexCache.set(workspacePath, { items, cachedAt: Date.now() });
      return items;
    } finally {
      this.pendingIndexes.delete(workspacePath);
    }
  }

  private async buildWorkspaceIndex(workspacePath: string): Promise<ContextItem[]> {
    let fileList: string[];
    try {
      const git = simpleGit(workspacePath);
      // NUL delimiters preserve spaces, Unicode, and newlines in Git file names.
      const raw: string = await git.raw([
        'ls-files',
        '-z',
        '--cached',
        '--others',
        '--exclude-standard',
      ]);
      fileList = [...new Set(raw.split('\0').filter(Boolean))];
    } catch {
      fileList = await this.scanDirFallback(workspacePath);
    }

    const items: ContextItem[] = [];
    const folders = new Set<string>();
    for (const file of fileList) {
      items.push({
        id: `file:${file}`,
        type: 'file',
        title: path.basename(file),
        subtitle: file,
        value: file,
      });
      const dir = path.dirname(file);
      if (dir === '.') continue;
      let current = '';
      for (const segment of dir.split('/')) {
        current = current ? `${current}/${segment}` : segment;
        folders.add(current);
      }
    }
    // Show files before folders for an empty search so large directory trees
    // cannot fill the entire 50-result limit before any file is offered.
    for (const folder of folders) {
      items.push({
        id: `folder:${folder}`,
        type: 'folder',
        title: `${path.basename(folder)}/`,
        subtitle: folder,
        value: folder,
      });
    }
    return items;
  }

  private async scanDirFallback(dir: string, baseDir = dir): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const results: string[] = [];

    for (const entry of entries) {
      if (
        entry.name.startsWith('.') ||
        entry.name === 'node_modules' ||
        entry.name === 'dist' ||
        entry.name === '.git'
      ) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = await this.scanDirFallback(fullPath, baseDir);
        results.push(...nested);
      } else if (entry.isFile()) {
        results.push(path.relative(baseDir, fullPath));
      }
    }

    return results;
  }
}
