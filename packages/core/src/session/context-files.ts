import fs from 'node:fs';
import path from 'node:path';
import { getHandoffRetentionMs } from '../config/runtime-defaults.js';

const readableFiles = new Map<string, { sessionId: string; expiresAt: number }>();

/** Grant only this session read access to a host-created context document. */
export function registerContextFile(sessionId: string, filePath: string): void {
  const canonical = fs.realpathSync(filePath);
  if (readableFiles.size >= 500) readableFiles.delete(readableFiles.keys().next().value!);
  readableFiles.set(canonical, { sessionId, expiresAt: Date.now() + getHandoffRetentionMs() });
}

export function resolveContextFile(
  sessionId: string | undefined,
  requestedPath: string,
  cwd: string,
): string | undefined {
  if (!sessionId) return undefined;
  let canonical: string;
  try {
    canonical = fs.realpathSync(path.resolve(cwd, requestedPath));
  } catch {
    return undefined;
  }
  const grant = readableFiles.get(canonical);
  if (!grant || grant.sessionId !== sessionId) return undefined;
  if (grant.expiresAt <= Date.now()) {
    readableFiles.delete(canonical);
    return undefined;
  }
  return canonical;
}
