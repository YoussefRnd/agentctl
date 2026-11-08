import { resolveSessionContextDocument } from '../../context/session-documents.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { RequestError } from '@agentclientprotocol/sdk';
import { resolveAllowedPath } from '../../security/path-security.js';

export interface ReadTextFileParams {
  path: string;
  line?: number;
  limit?: number;
}

export interface WriteTextFileParams {
  path: string;
  content: string;
}

export function assertAcpAbsolutePath(value: string): void {
  if (!path.isAbsolute(value))
    throw RequestError.invalidParams(undefined, 'ACP paths must be absolute');
}

export async function handleFsReadTextFile(
  params: ReadTextFileParams,
  cwd: string,
  additionalDirectories?: string[],
  localSessionId?: string,
): Promise<{ content: string }> {
  assertAcpAbsolutePath(params.path);
  if (params.line !== undefined && (!Number.isSafeInteger(params.line) || params.line < 1))
    throw RequestError.invalidParams(undefined, 'line must be a positive integer');
  if (params.limit !== undefined && (!Number.isSafeInteger(params.limit) || params.limit < 0))
    throw RequestError.invalidParams(undefined, 'limit must be a non-negative integer');
  const absPath =
    resolveSessionContextDocument(localSessionId, params.path) ??
    resolveAllowedPath(params.path, cwd, additionalDirectories);
  let content = await fs.readFile(absPath, 'utf8');
  if (params.line !== undefined || params.limit !== undefined) {
    const lines = content.split('\n');
    const startLine = params.line !== undefined ? params.line - 1 : 0;
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
  assertAcpAbsolutePath(params.path);
  const absPath = resolveAllowedPath(params.path, cwd, additionalDirectories, true);
  const dir = path.dirname(absPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(absPath, params.content, 'utf8');
  return {};
}
