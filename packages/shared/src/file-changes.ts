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
  const text = patch.text;
  const hunkHeader = /@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/y;
  // Scan offsets instead of splitting the whole patch into an array of line strings.
  // Only file headers need a substring; ordinary hunk lines need their first character.
  for (let start = 0; start <= text.length;) {
    const newline = text.indexOf('\n', start);
    const next = newline === -1 ? text.length + 1 : newline + 1;
    const end = newline === -1 ? text.length : newline;
    const lineEnd =
      newline !== -1 && end > start && text.charCodeAt(end - 1) === 13 ? end - 1 : end;
    const first = text.charCodeAt(start);
    const preamble = first === 100 && text.startsWith('diff --git ', start);
    const oldHeader = first === 45 && text.startsWith('--- ', start);
    if (preamble || (oldHeader && !oldRemaining && !newRemaining)) {
      if (preamble || !file || file.hasNewHeader) {
        file = { stats: { additions: 0, deletions: 0 } };
        files.push(file);
      }
      oldRemaining = newRemaining = 0;
    }
    if (file) {
      if (!oldRemaining && !newRemaining) {
        if (oldHeader) file.oldPath = patchPath(text.slice(start + 4, lineEnd));
        else if (first === 43 && text.startsWith('+++ ', start)) {
          file.path = patchPath(text.slice(start + 4, lineEnd));
          file.hasNewHeader = true;
        }
        if (first === 64) {
          hunkHeader.lastIndex = start;
          const hunk = hunkHeader.exec(text);
          if (hunk) {
            oldRemaining = Number(hunk[1] ?? 1);
            newRemaining = Number(hunk[2] ?? 1);
          }
        }
      } else if (first === 43 && newRemaining > 0) {
        file.stats.additions++;
        newRemaining--;
      } else if (first === 45 && oldRemaining > 0) {
        file.stats.deletions++;
        oldRemaining--;
      } else if (first === 32 && oldRemaining > 0 && newRemaining > 0) {
        oldRemaining--;
        newRemaining--;
      } else if (first !== 92) oldRemaining = newRemaining = 0;
    }
    start = next;
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
