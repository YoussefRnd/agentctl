import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { AppError } from '../../errors/app-error.js';

/** Host filesystem operations; does not query projects or create sessions. */
export class ProjectDirectory {
  constructor(private readonly searchPaths?: string) {}

  async resolve(input: string, loadKnownPaths: () => Promise<string[]>): Promise<string> {
    const trimmedPath = input?.trim();
    if (!trimmedPath) {
      throw new AppError('Path cannot be empty', 400);
    }

    let normalizedPath = path.resolve(path.normalize(trimmedPath));

    let pathExists = false;
    try {
      const st = await fs.stat(normalizedPath);
      pathExists = st.isDirectory();
    } catch {
      pathExists = false;
    }

    if (!pathExists) {
      const isExplicitAbsolutePath =
        path.isAbsolute(trimmedPath) || path.win32.isAbsolute(trimmedPath);
      if (isExplicitAbsolutePath) {
        throw new AppError(`Cannot open folder: path does not exist: ${trimmedPath}`, 400);
      }

      const rawName = path.basename(trimmedPath);
      const isBareFolderName = rawName === trimmedPath && !trimmedPath.includes('\\');
      if (rawName && rawName !== '.' && isBareFolderName) {
        const candidatePaths = new Set<string>();

        for (const knownPath of await loadKnownPaths()) {
          if (knownPath) {
            candidatePaths.add(path.join(path.dirname(knownPath), rawName));
          }
        }

        const configuredRoots = this.searchPaths
          ?.split(path.delimiter)
          .map((root) => root.trim())
          .filter(Boolean);
        const home = os.homedir();
        const searchRoots = configuredRoots?.length
          ? configuredRoots
          : [
              home,
              ...['Documents', 'Projects', 'Code', 'Desktop'].map((dir) => path.join(home, dir)),
            ];
        for (const root of searchRoots) {
          candidatePaths.add(path.join(root, rawName));
        }

        const matches = new Set<string>();
        for (const candidate of candidatePaths) {
          try {
            const st = await fs.stat(candidate);
            if (st.isDirectory()) {
              matches.add(await fs.realpath(candidate));
            }
          } catch {
            // continue
          }
        }

        if (matches.size > 1) {
          throw new AppError(
            `Cannot open folder: multiple folders named "${rawName}" were found; use the full path`,
            400,
          );
        }
        const [match] = matches;
        if (match) {
          normalizedPath = match;
        }
      }
    }

    return normalizedPath;
  }

  async explore(selectedPath?: string) {
    const targetPath = selectedPath ?? os.homedir();
    try {
      const stats = await fs.stat(targetPath);
      if (!stats.isDirectory()) {
        return {
          currentPath: targetPath,
          parentPath: path.dirname(targetPath),
          folders: [],
          error: 'Not a directory',
        };
      }
      const entries = await fs.readdir(targetPath, { withFileTypes: true });
      const folderPromises = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map(async (e) => {
          const fullPath = path.join(targetPath, e.name);
          let isRepo = false;
          try {
            const gitPath = path.join(fullPath, '.git');
            const gitStats = await fs.stat(gitPath);
            isRepo = gitStats.isDirectory();
          } catch {
            // Git directory does not exist or is not readable
          }
          return { name: e.name, path: fullPath, isRepo };
        });
      const folders = await Promise.all(folderPromises);
      folders.sort((a, b) =>
        a.isRepo === b.isRepo ? a.name.localeCompare(b.name) : a.isRepo ? -1 : 1,
      );
      return { currentPath: targetPath, parentPath: path.dirname(targetPath), folders };
    } catch (err: unknown) {
      return {
        currentPath: targetPath,
        parentPath: path.dirname(targetPath),
        folders: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
