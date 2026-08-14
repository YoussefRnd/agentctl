export type DiffLineType = 'added' | 'removed' | 'context' | 'meta';

export interface DiffLine {
  type: DiffLineType;
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
  highlights?: { start: number; end: number }[];
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  hunks: DiffHunk[];
}

export function parseDiff(diff: string): DiffHunk[] {
  const lines = diff.split('\n');
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;

  let oldLineNum = 0;
  let newLineNum = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('@@')) {
      // Parse header: @@ -1,4 +1,4 @@
      const match = /@@ -(\d+),?\d* \+(\d+),?\d* @@/.exec(line);
      if (match) {
        oldLineNum = parseInt(match[1], 10);
        newLineNum = parseInt(match[2], 10);
      }

      currentHunk = {
        header: line,
        lines: [],
      };
      hunks.push(currentHunk);
      continue;
    }

    if (!currentHunk) continue;

    if (line.startsWith('+')) {
      currentHunk.lines.push({
        type: 'added',
        content: line.slice(1),
        newLineNumber: newLineNum++,
      });
    } else if (line.startsWith('-')) {
      currentHunk.lines.push({
        type: 'removed',
        content: line.slice(1),
        oldLineNumber: oldLineNum++,
      });
    } else if (line.startsWith(' ')) {
      currentHunk.lines.push({
        type: 'context',
        content: line.slice(1),
        oldLineNumber: oldLineNum++,
        newLineNumber: newLineNum++,
      });
    } else if (line === '') {
      // Handle empty lines which might be context or just trailing
      if (i < lines.length - 1) {
        currentHunk.lines.push({
          type: 'context',
          content: '',
          oldLineNumber: oldLineNum++,
          newLineNumber: newLineNum++,
        });
      }
    }
  }

  // Apply character-level highlighting for adjacent removed/added lines
  for (const hunk of hunks) {
    for (let i = 0; i < hunk.lines.length - 1; i++) {
      const current = hunk.lines[i];
      const next = hunk.lines[i + 1];

      if (current.type === 'removed' && next.type === 'added') {
        const { removedHighlights, addedHighlights } = computeLineDiff(
          current.content,
          next.content,
        );
        current.highlights = removedHighlights;
        next.highlights = addedHighlights;
      }
    }
  }

  return hunks;
}

/**
 * Simple word-based diff for character-level highlighting.
 */
function computeLineDiff(oldLine: string, newLine: string) {
  const removedHighlights: { start: number; end: number }[] = [];
  const addedHighlights: { start: number; end: number }[] = [];

  // Very simple approach: find common prefix and suffix
  let prefixLen = 0;
  while (
    prefixLen < oldLine.length &&
    prefixLen < newLine.length &&
    oldLine[prefixLen] === newLine[prefixLen]
  ) {
    prefixLen++;
  }

  let suffixLen = 0;
  while (
    suffixLen < oldLine.length - prefixLen &&
    suffixLen < newLine.length - prefixLen &&
    oldLine[oldLine.length - 1 - suffixLen] === newLine[newLine.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  if (prefixLen < oldLine.length - suffixLen) {
    removedHighlights.push({ start: prefixLen, end: oldLine.length - suffixLen });
  }
  if (prefixLen < newLine.length - suffixLen) {
    addedHighlights.push({ start: prefixLen, end: newLine.length - suffixLen });
  }

  return { removedHighlights, addedHighlights };
}
