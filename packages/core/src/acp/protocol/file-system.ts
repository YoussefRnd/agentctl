import fs from 'node:fs';
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

export function handleFsReadTextFile(
  params: ReadTextFileParams,
  cwd: string,
  additionalDirectories?: string[],
): { content: string } {
  const absPath = resolveAllowedPath(params.path, cwd, additionalDirectories);
  if (!fs.existsSync(absPath)) {
    throw new Error(`File not found: ${absPath}`);
  }
  let content = fs.readFileSync(absPath, 'utf8');
  if (params.line !== undefined || params.limit !== undefined) {
    const lines = content.split('\n');
    const startLine = params.line !== undefined ? Math.max(0, params.line - 1) : 0;
    const endLine = params.limit !== undefined ? startLine + params.limit : lines.length;
    content = lines.slice(startLine, endLine).join('\n');
  }
  return { content };
}

export function handleFsWriteTextFile(
  params: WriteTextFileParams,
  cwd: string,
  additionalDirectories?: string[],
): Record<string, never> {
  const absPath = resolveAllowedPath(params.path, cwd, additionalDirectories, true);
  const dir = path.dirname(absPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(absPath, params.content, 'utf8');
  return {};
}
