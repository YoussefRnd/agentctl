import path from 'node:path';
import { listGitFiles } from './git-context.js';
import type { ContextItem } from './types.js';
import { scanDirectory } from './context-files.js';
const CACHE_TTL_MS = 5000;
const MAX_CACHED_WORKSPACES = 20;

/** Owns bounded workspace indexes and coalesces only each workspace's active scan. */
export class WorkspaceIndex {
  private workspaceIndexCache = new Map<string, { items: ContextItem[]; cachedAt: number }>();
  private pendingIndexes = new Map<string, Promise<ContextItem[]>>();
  async get(workspacePath: string): Promise<ContextItem[]> {
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
      fileList = await listGitFiles(workspacePath);
    } catch {
      fileList = await scanDirectory(workspacePath);
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
}
