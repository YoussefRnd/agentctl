import fs from 'node:fs';
import path from 'node:path';

/** Resolve symlinks before '..', including the ancestor of a not-yet-created file. */
function canonicalPath(rawPath: string): string {
  let candidate = rawPath;
  const suffix: string[] = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(candidate), ...suffix);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      // A broken symlink exists but cannot be canonicalized: fail closed.
      try {
        fs.lstatSync(candidate);
        throw error;
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') throw statError;
        if (statError === error) throw error;
      }
      const parent = path.dirname(candidate);
      if (parent === candidate) throw error;
      suffix.unshift(path.basename(candidate));
      candidate = parent;
    }
  }
}

export function resolveAllowedPath(
  requestedPath: string,
  cwd: string,
  additionalDirectories: string[] = [],
  _allowWrite = false,
): string {
  if (!requestedPath || requestedPath.includes('\0')) throw new Error('Invalid permission path');
  // path.resolve would erase symlink traversal before realpath can inspect it.
  const absoluteCwd = path.isAbsolute(cwd) ? cwd : `${process.cwd()}${path.sep}${cwd}`;
  const rawPath = path.isAbsolute(requestedPath)
    ? requestedPath
    : `${absoluteCwd}${path.sep}${requestedPath}`;
  const canonical = canonicalPath(rawPath);
  const roots = [absoluteCwd, ...additionalDirectories].map((root) =>
    canonicalPath(path.isAbsolute(root) ? root : `${absoluteCwd}${path.sep}${root}`),
  );
  const isWithin = roots.some((root) => {
    const relative = path.relative(root, canonical);
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  });
  if (!isWithin)
    throw new Error(
      `Directory traversal detected: path "${requestedPath}" is outside allowed roots.`,
    );
  return canonical;
}
