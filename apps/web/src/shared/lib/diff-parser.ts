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

export interface SplitDiffRow {
  left: DiffLine | null;
  right: DiffLine | null;
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
      // Handle empty lines which might be context or trailing
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

  // Apply word-level LCS highlighting for adjacent removed/added blocks
  for (const hunk of hunks) {
    let rIdx = 0;
    while (rIdx < hunk.lines.length) {
      if (hunk.lines[rIdx].type === 'removed') {
        const removedBlock: DiffLine[] = [];
        while (rIdx < hunk.lines.length && hunk.lines[rIdx].type === 'removed') {
          removedBlock.push(hunk.lines[rIdx]);
          rIdx++;
        }
        const addedBlock: DiffLine[] = [];
        while (rIdx < hunk.lines.length && hunk.lines[rIdx].type === 'added') {
          addedBlock.push(hunk.lines[rIdx]);
          rIdx++;
        }

        // Pair corresponding lines 1:1 up to min length
        const pairCount = Math.min(removedBlock.length, addedBlock.length);
        for (let k = 0; k < pairCount; k++) {
          const removed = removedBlock[k];
          const added = addedBlock[k];
          const { removedHighlights, addedHighlights } = computeWordDiff(
            removed.content,
            added.content,
          );
          removed.highlights = removedHighlights;
          added.highlights = addedHighlights;
        }
      } else {
        rIdx++;
      }
    }
  }

  return hunks;
}

interface Token {
  text: string;
  start: number;
  end: number;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const regex = /(\w+|\s+|[^\w\s])/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    tokens.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return tokens;
}

/**
 * Word-level tokenized LCS diff for high-precision character highlighting.
 */
export function computeWordDiff(oldLine: string, newLine: string) {
  if (oldLine === newLine) {
    return { removedHighlights: [], addedHighlights: [] };
  }

  const oldTokens = tokenize(oldLine);
  const newTokens = tokenize(newLine);

  const m = oldTokens.length;
  const n = newTokens.length;

  if (m === 0 && n === 0) {
    return { removedHighlights: [], addedHighlights: [] };
  }

  if (m === 0) {
    return {
      removedHighlights: [],
      addedHighlights: [{ start: 0, end: newLine.length }],
    };
  }

  if (n === 0) {
    return {
      removedHighlights: [{ start: 0, end: oldLine.length }],
      addedHighlights: [],
    };
  }

  // Classic DP table for LCS
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array.from<number>({ length: n + 1 }).fill(0),
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldTokens[i - 1].text === newTokens[j - 1].text) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to identify matched tokens
  const matchedOld = new Set<number>();
  const matchedNew = new Set<number>();

  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (oldTokens[i - 1].text === newTokens[j - 1].text) {
      matchedOld.add(i - 1);
      matchedNew.add(j - 1);
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  function getHighlights(tokens: Token[], matched: Set<number>): { start: number; end: number }[] {
    const highlights: { start: number; end: number }[] = [];
    let curStart: number | null = null;
    let curEnd: number | null = null;

    for (let k = 0; k < tokens.length; k++) {
      if (!matched.has(k)) {
        if (curStart === null) {
          curStart = tokens[k].start;
        }
        curEnd = tokens[k].end;
      } else {
        if (curStart !== null && curEnd !== null) {
          highlights.push({ start: curStart, end: curEnd });
          curStart = null;
          curEnd = null;
        }
      }
    }

    if (curStart !== null && curEnd !== null) {
      highlights.push({ start: curStart, end: curEnd });
    }

    return highlights;
  }

  return {
    removedHighlights: getHighlights(oldTokens, matchedOld),
    addedHighlights: getHighlights(newTokens, matchedNew),
  };
}

/**
 * Builds aligned side-by-side rows for split diff view, inserting spacers
 * so corresponding context lines remain horizontally aligned.
 */
export function buildSplitRows(lines: DiffLine[]): SplitDiffRow[] {
  const rows: SplitDiffRow[] = [];
  let removedBuffer: DiffLine[] = [];
  let addedBuffer: DiffLine[] = [];

  const flushBuffers = () => {
    const maxLen = Math.max(removedBuffer.length, addedBuffer.length);
    for (let idx = 0; idx < maxLen; idx++) {
      rows.push({
        left: removedBuffer[idx] ?? null,
        right: addedBuffer[idx] ?? null,
      });
    }
    removedBuffer = [];
    addedBuffer = [];
  };

  for (const line of lines) {
    if (line.type === 'removed') {
      if (addedBuffer.length > 0) {
        flushBuffers();
      }
      removedBuffer.push(line);
    } else if (line.type === 'added') {
      addedBuffer.push(line);
    } else {
      flushBuffers();
      rows.push({ left: line, right: line });
    }
  }

  flushBuffers();
  return rows;
}
