import fs from 'node:fs/promises';
import path from 'node:path';

/** Validate a literal, project-relative file path without following symlink parents. */
export async function resolveWorkspaceFile(
  workspacePath: string,
  filePath: string,
): Promise<string> {
  if (
    !filePath ||
    path.isAbsolute(filePath) ||
    path.win32.isAbsolute(filePath) ||
    filePath.includes('\0')
  ) {
    throw new Error('A relative workspace file path is required');
  }
  const parts = filePath.split(path.sep);
  if (
    parts.some((part) => !part || part === '..' || part === '.' || part.toLowerCase() === '.git')
  ) {
    throw new Error('File path must stay inside the workspace and outside Git metadata');
  }
  const root = await fs.realpath(workspacePath);
  let current = root;
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (stat?.isSymbolicLink()) throw new Error('File path crosses a symbolic link');
  }
  return path.join(root, ...parts);
}
