import fs from 'node:fs';
import path from 'node:path';

const realpathCache = new Map<string, { resolved: string; mtime: number }>();
const REALPATH_CACHE_TTL_MS = 5000;

export function clearRealpathCache(): void {
  realpathCache.clear();
}

function cachedRealpath(p: string): string {
  const now = Date.now();
  const cached = realpathCache.get(p);
  if (cached && now - cached.mtime < REALPATH_CACHE_TTL_MS) {
    return cached.resolved;
  }
  let resolved: string;
  try {
    resolved = fs.existsSync(p) ? fs.realpathSync(p) : path.normalize(p);
  } catch {
    resolved = path.normalize(p);
  }
  if (realpathCache.size > 500) {
    const oldestKey = realpathCache.keys().next().value;
    if (oldestKey) realpathCache.delete(oldestKey);
  }
  realpathCache.set(p, { resolved, mtime: now });
  return resolved;
}

export function resolveAllowedPath(
  requestedPath: string,
  cwd: string,
  additionalDirectories: string[] = [],
  _allowWrite = false,
): string {
  const resolved = path.isAbsolute(requestedPath)
    ? requestedPath
    : path.resolve(cwd, requestedPath);

  const canonical = cachedRealpath(resolved);
  const roots = [cachedRealpath(cwd), ...additionalDirectories.map((d) => cachedRealpath(d))];

  const isWithin = roots.some((root) => {
    const rel = path.relative(root, canonical);
    return !rel.startsWith('..') && !path.isAbsolute(rel);
  });

  if (!isWithin) {
    throw new Error(
      `Directory traversal detected: path "${requestedPath}" is outside allowed roots.`,
    );
  }

  return canonical;
}
