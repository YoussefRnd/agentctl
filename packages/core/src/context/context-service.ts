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
const CACHE_TTL_MS = 5000; // 5s workspace file list TTL cache

export class ContextService {
  private fileListCache = new Map<string, { files: string[]; cachedAt: number }>();

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
        const fileList = await this.getWorkspaceFiles(workspacePath);

        const folders = new Set<string>();

        // Collect folders and filter files
        for (const file of fileList) {
          const dir = path.dirname(file);
          if (dir && dir !== '.') {
            const segments = dir.split('/');
            let current = '';
            for (const seg of segments) {
              current = current ? `${current}/${seg}` : seg;
              folders.add(current);
            }
          }
        }

        // Add Folders
        if (filterType === 'all' || filterType === 'folder') {
          for (const folder of Array.from(folders)) {
            const folderName = path.basename(folder);
            results.push({
              id: `folder:${folder}`,
              type: 'folder',
              title: `${folderName}/`,
              subtitle: folder,
              value: folder,
            });
          }
        }

        // Add Files
        if (filterType === 'all' || filterType === 'file') {
          for (const file of fileList) {
            const fileName = path.basename(file);
            results.push({
              id: `file:${file}`,
              type: 'file',
              title: fileName,
              subtitle: file,
              value: file,
            });
          }
        }
      } catch {
        // Workspace read error
      }
    }

    if (!q) {
      return results.slice(0, 50);
    }

    // Score all candidate items with fuzzy subsequence matching
    const scored: Array<{ item: ContextItem; score: number }> = [];

    for (const item of results) {
      // Score against both the short title (e.g. app.ts) and full path (e.g. apps/server/src/app.ts)
      const titleScore = this.fuzzyScore(item.title, q);
      const pathScore = item.subtitle ? this.fuzzyScore(item.subtitle, q) : -1;
      const idScore = item.id.startsWith('git:') ? this.fuzzyScore(item.id, q) : -1;

      const maxScore = Math.max(titleScore, pathScore, idScore);
      if (maxScore > 0) {
        scored.push({ item, score: maxScore });
      }
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, 50)
      .map((s) => s.item);
  }

  /**
   * Fast, high-precision fuzzy subsequence scoring (fzf-style).
   * Returns positive score if query is a subsequence of target, or -1 if no match.
   */
  private fuzzyScore(target: string, query: string): number {
    if (!query) return 100;
    const t = target.toLowerCase();
    const q = query.toLowerCase();

    let tIdx = 0;
    let qIdx = 0;
    let score = 0;
    let consecutive = 0;

    while (tIdx < t.length && qIdx < q.length) {
      if (t[tIdx] === q[qIdx]) {
        score += 10;
        // Consecutive match bonus
        if (consecutive > 0) score += consecutive * 15;
        consecutive++;

        // Word boundary bonus (start of string or preceded by /, -, _, ., space)
        if (tIdx === 0 || '/-_ .:'.includes(t[tIdx - 1])) {
          score += 35;
        }
        qIdx++;
      } else {
        consecutive = 0;
      }
      tIdx++;
    }

    // Must match all characters of query in order
    if (qIdx < q.length) return -1;

    // Exact match bonus
    if (t === q) score += 200;
    else if (t.startsWith(q)) score += 80;

    // Penalty for length gap
    score -= (t.length - q.length) * 0.4;
    return Math.max(1, score);
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

  private async getWorkspaceFiles(workspacePath: string): Promise<string[]> {
    const cached = this.fileListCache.get(workspacePath);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return cached.files;
    }

    let fileList: string[] = [];
    try {
      const git = simpleGit(workspacePath);
      const raw: string = await git.raw(['ls-files', '--cached', '--others', '--exclude-standard']);
      fileList = raw
        .split('\n')
        .map((f: string) => f.trim())
        .filter((f: string) => f.length > 0);
    } catch {
      fileList = await this.scanDirFallback(workspacePath);
    }

    this.fileListCache.set(workspacePath, { files: fileList, cachedAt: Date.now() });
    return fileList;
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
