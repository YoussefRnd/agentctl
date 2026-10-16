import fs from 'node:fs/promises';
import { SourceRepository } from './source-repository.js';
import type { RepositoryBackend } from './types.js';

/** Backend selection is explicit and ordered; callers never probe Git themselves. */
export class RepositoryService {
  constructor(private readonly backends: readonly RepositoryBackend[]) {
    if (new Set(backends.map((backend) => backend.id)).size !== backends.length)
      throw new Error('Repository backend IDs must be unique');
  }

  async open(workspacePath: string): Promise<SourceRepository> {
    if (!(await fs.stat(workspacePath)).isDirectory())
      throw new Error('Selected path is not a directory');
    const canonicalPath = await fs.realpath(workspacePath);
    for (const backend of this.backends) {
      const workspace = await backend.open(canonicalPath);
      if (workspace) return new SourceRepository(backend.id, workspace);
    }
    throw new Error('No repository backend supports this workspace');
  }
}
