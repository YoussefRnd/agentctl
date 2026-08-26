import { describe, it, expect } from 'vitest';
import { parseDiff, computeWordDiff, buildSplitRows, type DiffLine } from './diff-parser';

describe('diff-parser', () => {
  it('computes word-level diff highlights for token changes within a line', () => {
    const oldLine = 'const value = calculateSum(a, b);';
    const newLine = 'const value = calculateTotal(a, b, c);';

    const { removedHighlights, addedHighlights } = computeWordDiff(oldLine, newLine);

    expect(removedHighlights.length).toBeGreaterThan(0);
    expect(addedHighlights.length).toBeGreaterThan(0);

    const removedText = removedHighlights.map((h) => oldLine.slice(h.start, h.end)).join('');
    expect(removedText).toBe('calculateSum');

    const addedText = addedHighlights.map((h) => newLine.slice(h.start, h.end)).join('');
    expect(addedText).toContain('calculateTotal');
  });

  it('builds aligned side-by-side rows for split diff view with padding spacers', () => {
    const lines: DiffLine[] = [
      { type: 'context', content: 'header', oldLineNumber: 1, newLineNumber: 1 },
      { type: 'removed', content: 'del 1', oldLineNumber: 2 },
      { type: 'removed', content: 'del 2', oldLineNumber: 3 },
      { type: 'added', content: 'add 1', newLineNumber: 2 },
      { type: 'context', content: 'footer', oldLineNumber: 4, newLineNumber: 3 },
    ];

    const rows = buildSplitRows(lines);

    expect(rows).toHaveLength(4);

    expect(rows[0].left?.content).toBe('header');
    expect(rows[0].right?.content).toBe('header');

    expect(rows[1].left?.content).toBe('del 1');
    expect(rows[1].right?.content).toBe('add 1');

    expect(rows[2].left?.content).toBe('del 2');
    expect(rows[2].right).toBeNull();

    expect(rows[3].left?.content).toBe('footer');
    expect(rows[3].right?.content).toBe('footer');
  });

  it('parses unified git diff correctly', () => {
    const rawDiff = `@@ -1,3 +1,3 @@
 context 1
-old line
+new line
 context 2`;

    const hunks = parseDiff(rawDiff);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].lines).toHaveLength(4);
    expect(hunks[0].lines[1].type).toBe('removed');
    expect(hunks[0].lines[2].type).toBe('added');
    expect(hunks[0].lines[1].highlights).toBeDefined();
    expect(hunks[0].lines[2].highlights).toBeDefined();
  });
});
