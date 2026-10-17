import type { SidebarProject } from '@agentctl/api-client';
/** Resolves a dropped workspace without owning navigation, networking or desktop globals. */
export function resolveDroppedWorkspace(
  transfer: Pick<DataTransfer, 'files' | 'getData'>,
  projects: SidebarProject[],
  getPathForFile?: (file: File) => string,
) {
  const files = transfer?.files;
  const firstFile = files?.[0];

  let resolvedPath: string | undefined = undefined;

  // Prefer the supplied desktop path capability, then portable drag metadata.
  if (firstFile && getPathForFile) {
    try {
      resolvedPath = getPathForFile(firstFile);
    } catch {
      // fallback
    }
  }

  // 2. Electron / node-enabled File.path
  if (
    !resolvedPath &&
    firstFile &&
    'path' in firstFile &&
    typeof (firstFile as { path?: string }).path === 'string' &&
    (firstFile as { path?: string }).path
  ) {
    resolvedPath = (firstFile as { path?: string }).path;
  }

  // 3. text/uri-list (Standard MIME type from OS file managers: Nautilus, Dolphin, macOS Finder)
  if (!resolvedPath && transfer) {
    const uriList = transfer.getData('text/uri-list');
    if (uriList) {
      const lines = uriList.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.startsWith('file://')) {
          try {
            const url = new URL(trimmed);
            let p = decodeURIComponent(url.pathname);
            if (/^\/[a-zA-Z]:/.test(p)) {
              p = p.slice(1);
            }
            if (p) {
              resolvedPath = p;
              break;
            }
          } catch {
            // continue
          }
        }
      }
    }
  }

  // 4. text/plain fallback (Raw file path or file:// URL)
  if (!resolvedPath && transfer) {
    const textPlain = transfer.getData('text/plain');
    if (textPlain) {
      const lines = textPlain.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('file://')) {
          try {
            const url = new URL(trimmed);
            let p = decodeURIComponent(url.pathname);
            if (/^\/[a-zA-Z]:/.test(p)) {
              p = p.slice(1);
            }
            if (p) {
              resolvedPath = p;
              break;
            }
          } catch {
            // continue
          }
        } else if (trimmed.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(trimmed)) {
          resolvedPath = trimmed;
          break;
        }
      }
    }
  }

  // 5. Match against existing registered projects by folder name
  const folderName = firstFile?.name?.replace(/[\\/]$/, '');
  if (!resolvedPath && folderName && projects.length > 0) {
    const cleanName = folderName.toLowerCase();
    const match = projects.find(
      (p) =>
        p.name.toLowerCase() === cleanName ||
        p.path.toLowerCase().endsWith(`/${cleanName}`) ||
        p.path.toLowerCase().endsWith(`\\${cleanName}`),
    );
    if (match) {
      resolvedPath = match.path;
    }
  }

  // 6. Path to attempt opening: either full resolved path or the folder name (server searches candidate directories)
  return { pathToOpen: resolvedPath || folderName, resolvedPath };
}
