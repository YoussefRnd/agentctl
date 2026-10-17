import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveAllowedPath } from '../security/path-security.js';

export const MAX_FILE_SIZE_BYTES = 48 * 1024;

/** Canonicalize before reading so attachments cannot follow links outside the workspace. */
export function resolveContextPath(workspace: string, requested: string): string {
  return resolveAllowedPath(requested, workspace);
}

export async function readContextFile(workspace: string, requested: string) {
  const fullPath = resolveContextPath(workspace, requested);
  const handle = await fs.open(fullPath, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) return undefined;
    const bytes = Buffer.alloc(MAX_FILE_SIZE_BYTES);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    // Streaming decode withholds an incomplete trailing UTF-8 sequence on truncation.
    const truncated = stat.size > bytesRead;
    const content = new TextDecoder().decode(bytes.subarray(0, bytesRead), { stream: truncated });
    return { content, size: stat.size, truncated };
  } finally {
    await handle.close();
  }
}

export async function scanDirectory(dir: string, baseDir = dir): Promise<string[]> {
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
      const nested = await scanDirectory(fullPath, baseDir);
      results.push(...nested);
    } else if (entry.isFile()) {
      results.push(path.relative(baseDir, fullPath));
    }
  }

  return results;
}
