import type { SidebarProject } from '@agentctl/api-client';

function readFileUri(value: string): string | undefined {
  if (!value.startsWith('file://')) return undefined;
  try {
    const path = decodeURIComponent(new URL(value).pathname);
    return (/^\/[a-zA-Z]:/.test(path) ? path.slice(1) : path) || undefined;
  } catch {
    return undefined;
  }
}

function readDragPaths(value: string, allowPlainPath = false): string | undefined {
  for (const line of value.split(/\r?\n/)) {
    const text = line.trim();
    const uri = readFileUri(text);
    if (uri) return uri;
    if (allowPlainPath && (text.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(text))) return text;
  }
}

export function resolveDroppedWorkspace(
  transfer: Pick<DataTransfer, 'files' | 'getData'>,
  projects: SidebarProject[],
  getPathForFile?: (file: File) => string,
) {
  const firstFile = transfer?.files?.[0];
  let resolvedPath: string | undefined;
  if (firstFile && getPathForFile) {
    try {
      resolvedPath = getPathForFile(firstFile) || undefined;
    } catch {
      // Some hosts cannot resolve File objects from the OS. Drag metadata may still carry a path.
    }
  }
  if (!resolvedPath && firstFile && 'path' in firstFile && typeof firstFile.path === 'string') {
    resolvedPath = firstFile.path || undefined;
  }

  if (!resolvedPath && transfer) {
    resolvedPath =
      readDragPaths(transfer.getData('text/uri-list')) ??
      readDragPaths(transfer.getData('text/plain'), true);
  }

  const folderName = firstFile?.name?.replace(/[\\/]$/, '');
  if (!resolvedPath && folderName) {
    const cleanName = folderName.toLowerCase();
    resolvedPath = projects.find(
      (project) =>
        project.name.toLowerCase() === cleanName ||
        project.path.toLowerCase().endsWith(`/${cleanName}`) ||
        project.path.toLowerCase().endsWith(`\\${cleanName}`),
    )?.path;
  }

  // The server searches candidate directories when supplied a folder name.
  return { pathToOpen: resolvedPath || folderName, resolvedPath };
}
