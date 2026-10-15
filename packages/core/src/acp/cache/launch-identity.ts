import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function executableFingerprint(command: string, env: Record<string, string>): string | null {
  const candidates = command.includes(path.sep)
    ? [command]
    : (env.PATH ?? process.env.PATH ?? '')
        .split(path.delimiter)
        .filter(Boolean)
        .map((directory) => path.join(directory, command));

  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile()) return `${candidate}:${String(stat.size)}:${String(stat.mtimeMs)}`;
    } catch {
      // Continue searching PATH.
    }
  }
  return null;
}

export function getCacheKey(
  command: string,
  args: string[],
  env: Record<string, string>,
  options?: { providerVersion?: string; protocolVersion?: string },
): string {
  const sortedEnv: Record<string, string> = {};
  for (const k of Object.keys(env).sort()) {
    sortedEnv[k] = env[k];
  }
  const data = JSON.stringify({
    schemaVersion: 4,
    command,
    args,
    env: sortedEnv,
    executable: executableFingerprint(command, env),
    providerVersion: options?.providerVersion,
    protocolVersion: options?.protocolVersion,
  });
  return crypto.hash('sha256', data);
}
