import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveAllowedPath } from '../transport/path-security.js';

export interface ReadTextFileParams {
  path: string;
  line?: number;
  limit?: number;
}

export interface WriteTextFileParams {
  path: string;
  content: string;
}

export async function handleFsReadTextFile(
  params: ReadTextFileParams,
  cwd: string,
  additionalDirectories?: string[],
): Promise<{ content: string }> {
  const absPath = resolveAllowedPath(params.path, cwd, additionalDirectories);
  let content = await fs.readFile(absPath, 'utf8');
  if (params.line !== undefined || params.limit !== undefined) {
    const lines = content.split('\n');
    const startLine = params.line !== undefined ? Math.max(0, params.line - 1) : 0;
    const endLine = params.limit !== undefined ? startLine + params.limit : lines.length;
    content = lines.slice(startLine, endLine).join('\n');
  }
  return { content };
}

export async function handleFsWriteTextFile(
  params: WriteTextFileParams,
  cwd: string,
  additionalDirectories?: string[],
): Promise<Record<string, never>> {
  const absPath = resolveAllowedPath(params.path, cwd, additionalDirectories, true);
  const dir = path.dirname(absPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(absPath, params.content, 'utf8');
  return {};
}
