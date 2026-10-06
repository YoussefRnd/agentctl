import type { FileChange, FilePatch, FileChangeStats } from './schemas/file-change.js';

export interface NormalizedFileChange {
  operation: 'add' | 'modify' | 'delete';
  path: string;
  stats?: FileChangeStats;
}

function patchPath(header: string): string | undefined {
  let path = header.split('\t')[0];
  if (header.startsWith('"')) {
    const bytes: number[] = [];
    const encoder = new TextEncoder();
    const escapes: Record<string, number> = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11 };
    let closed = false;
    for (let i = 1; i < header.length; i++) {
      if (header[i] === '"') {
        closed = true;
        break;
      }
      if (header[i] === '\\') {
        const octal = /^[0-7]{1,3}/.exec(header.slice(i + 1));
        if (octal) {
          const byte = Number.parseInt(octal[0], 8);
          if (byte > 255) return undefined;
          bytes.push(byte);
          i += octal[0].length;
        } else {
          i++;
          if (i === header.length) return undefined;
          bytes.push(escapes[header[i]] ?? header.charCodeAt(i));
        }
      } else {
        const code = header.codePointAt(i)!;
        bytes.push(...encoder.encode(String.fromCodePoint(code)));
        if (code > 0xffff) i++;
      }
    }
    if (!closed) return undefined;
    path = new TextDecoder().decode(new Uint8Array(bytes));
  }
  if (path === '/dev/null') return undefined;
  return path.replace(/^[ab]\//, '');
}

function comparablePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
}

/** Count only hunk lines. Headers, binary patches and rename metadata are not edits. */
function patchStats(patch?: FilePatch | null) {
  const files: {
    oldPath?: string;
    path?: string;
    hasNewHeader?: boolean;
    stats: FileChangeStats;
  }[] = [];
  if (patch?.format !== 'git_patch') return files;
  let file: (typeof files)[number] | undefined;
  let oldRemaining = 0;
  let newRemaining = 0;
  for (const line of patch.text.split(/\r?\n/)) {
    if (
      line.startsWith('diff --git ') ||
      (line.startsWith('--- ') && !oldRemaining && !newRemaining)
    ) {
      if (line.startsWith('diff --git ') || !file || file.hasNewHeader) {
        file = { stats: { additions: 0, deletions: 0 } };
        files.push(file);
      }
      oldRemaining = newRemaining = 0;
    }
    if (!file) continue;
    if (!oldRemaining && !newRemaining) {
      if (line.startsWith('--- ')) file.oldPath = patchPath(line.slice(4));
      else if (line.startsWith('+++ ')) {
        file.path = patchPath(line.slice(4));
        file.hasNewHeader = true;
      }
      const hunk = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
      if (hunk) {
        oldRemaining = Number(hunk[1] ?? 1);
        newRemaining = Number(hunk[2] ?? 1);
      }
      continue;
    }
    if (line.startsWith('+') && newRemaining > 0) {
      file.stats.additions++;
      newRemaining--;
    } else if (line.startsWith('-') && oldRemaining > 0) {
      file.stats.deletions++;
      oldRemaining--;
    } else if (line.startsWith(' ') && oldRemaining > 0 && newRemaining > 0) {
      oldRemaining--;
      newRemaining--;
    } else if (!line.startsWith('\\')) oldRemaining = newRemaining = 0;
  }
  return files;
}

/** Structured operations own paths and kinds; a patch supplies display statistics only. */
export function normalizeFileChanges(diff: {
  changes: FileChange[];
  patch?: FilePatch | null;
}): NormalizedFileChange[] {
  const files = patchStats(diff.patch);
  const matched = (change: FileChange) => {
    const expected = comparablePath(change.path);
    const candidates = files.filter((file) => {
      const path = change.operation === 'delete' ? file.oldPath : file.path;
      if (!path) return false;
      const candidate = comparablePath(path);
      return expected === candidate || expected.endsWith('/' + candidate);
    });
    // An exact path disambiguates identical suffixes; never guess among alternatives.
    const exact = candidates.filter(
      (file) =>
        comparablePath((change.operation === 'delete' ? file.oldPath : file.path)!) === expected,
    );
    const matches = exact.length ? exact : candidates;
    return matches.length === 1 ? matches[0].stats : undefined;
  };
  return diff.changes.flatMap((change) => {
    const stats = matched(change);
    const withStats = (
      operation: NormalizedFileChange['operation'],
      path: string,
      value = stats,
    ): NormalizedFileChange => ({ operation, path, ...(value ? { stats: value } : {}) });
    switch (change.operation) {
      case 'add':
      case 'modify':
      case 'delete':
        return [withStats(change.operation, change.path)];
      case 'copy':
        return [withStats('add', change.path)];
      case 'move':
        return [
          ...(change.oldPath
            ? [
                withStats(
                  'delete',
                  change.oldPath,
                  stats ? { additions: 0, deletions: stats.deletions } : undefined,
                ),
              ]
            : []),
          withStats(
            'add',
            change.path,
            stats ? { additions: stats.additions, deletions: 0 } : undefined,
          ),
        ];
      default:
        return [];
    }
  });
}
