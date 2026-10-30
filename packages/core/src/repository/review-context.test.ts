import { expect, it, vi } from 'vite-plus/test';
import { collectReviewContext } from './review-context.js';
import type { RepositoryTextSnapshot } from './types.js';
import type { ReviewFile } from '@agentctl/shared';
function snapshot(files: Record<string, string>): RepositoryTextSnapshot {
  return {
    listFiles: async (limit) => ({
      files: Object.entries(files)
        .slice(0, limit)
        .map(([path, text]) => ({ path, size: text.length, kind: 'file' })),
      truncated: Object.keys(files).length > limit,
    }),
    readFile: async (path) =>
      path in files ? { status: 'text', text: files[path] } : { status: 'missing' },
    search: async (terms, limit) => {
      const paths = Object.keys(files).filter((path) =>
        terms.some((term) => files[path].includes(term)),
      );
      return { paths: paths.slice(0, limit), truncated: paths.length > limit };
    },
  };
}
const diff: ReviewFile[] = [
  {
    path: 'src/calculate.ts',
    state: 'modified',
    diff: '@@ -1,3 +1,3 @@\n import { lookupRate } from "./rates.js";\n-export function calculateTotal(value) { return lookupRate(value) * value; }\n+export function calculateTotal(value) { return lookupRate() * value; }',
  },
];
it('adds changed source, imported dependencies, callers and tests from immutable readers', async () => {
  const current = snapshot({
    'src/calculate.ts':
      'import { lookupRate } from "./rates.js";\nexport function calculateTotal(value) { return lookupRate() * value; }',
    'src/rates.ts': 'export function lookupRate(value) { return value.rate; }',
    'src/calculate.test.ts':
      'import { calculateTotal } from "./calculate";\nexpect(calculateTotal({rate: 2})).toBe(4);',
    'app/checkout.ts':
      'import { calculateTotal } from "../src/calculate";\nconst cost = calculateTotal(order);',
    'REVIEW.md': 'Check changed callers and report only concrete bugs.',
  });
  const bundle = await collectReviewContext({
    current,
    before: snapshot({ 'src/calculate.ts': 'PREVIOUS_SOURCE' }),
    files: diff,
  });
  expect(bundle.report.files).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: 'src/calculate.ts', side: 'current', role: 'changed' }),
      expect.objectContaining({ path: 'src/calculate.ts', side: 'before', role: 'changed' }),
      expect.objectContaining({ path: 'src/rates.ts', role: 'dependency' }),
      expect.objectContaining({ path: 'src/calculate.test.ts', role: 'test' }),
      expect.objectContaining({ path: 'app/checkout.ts', role: 'reference' }),
      expect.objectContaining({ path: 'REVIEW.md', role: 'guidance' }),
    ]),
  );
  expect(JSON.stringify(bundle.sources)).toContain('PREVIOUS_SOURCE');
  expect(bundle.report.limitations.join(' ')).toContain(
    'Context retrieval does not execute commands',
  );
});
it('excludes sensitive and generated source candidates while retaining explicit omissions', async () => {
  const current = snapshot({
    'src/calculate.ts':
      'import secret from "../credentials.json";\nexport function calculateTotal() {}',
    'credentials.json': 'PRIVATE_SECRET',
    '.env': 'API_KEY=PRIVATE_SECRET',
    'node_modules/rates/index.ts': 'PRIVATE_GENERATED',
  });
  const read = vi.spyOn(current, 'readFile');
  const bundle = await collectReviewContext({ current, before: null, files: diff });
  expect(JSON.stringify(bundle.sources)).not.toContain('PRIVATE_SECRET');
  expect(read.mock.calls.some(([path]) => path === 'credentials.json' || path === '.env')).toBe(
    false,
  );
  expect(bundle.report.omitted).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: 'credentials.json',
        reason: 'Sensitive or generated file excluded',
      }),
    ]),
  );
});
it('reports excerpt ranges and context limits rather than silently claiming complete source coverage', async () => {
  const text = Array.from(
    { length: 500 },
    (_, index) => `export const sourceLine${index + 1} = ${index};`,
  ).join('\n');
  const files: ReviewFile[] = [{ ...diff[0]!, diff: '@@ -240,2 +240,2 @@\n-old\n+new' }];
  const bundle = await collectReviewContext({
    current: snapshot({ 'src/calculate.ts': text }),
    before: null,
    files,
    maxCharacters: 15_000,
  });
  const file = bundle.report.files.find((file) => file.path === 'src/calculate.ts')!;
  expect(file.complete).toBe(false);
  expect(file.ranges[0].startLine).toBeGreaterThan(1);
  expect(file.ranges[0].startLine).toBeLessThanOrEqual(240);
  expect(bundle.report.limitations.join(' ')).toContain('excerpts');
  expect(JSON.stringify(bundle.sources).length).toBeLessThan(15_000);
});
it('falls back transparently for unsupported readers, time limits and failed searches', async () => {
  const fallback = await collectReviewContext({ current: null, before: null, files: diff });
  expect(fallback.sources).toEqual([]);
  expect(fallback.report.limitations.join(' ')).toContain('Only the captured diff');
  const current = snapshot({ 'src/calculate.ts': 'export function calculateTotal() {}' });
  current.search = async () => {
    throw new Error('Unavailable');
  };
  const failed = await collectReviewContext({ current, before: null, files: diff });
  expect(failed.report.searchTruncated).toBe(true);
  const controller = new AbortController();
  controller.abort();
  const cancelled = await collectReviewContext({
    current,
    before: null,
    files: diff,
    signal: controller.signal,
  });
  expect(cancelled.sources).toEqual([]);
  expect(cancelled.report.limitations.join(' ')).toContain('time limit');
});
it('resolves Python relative imports and reports deleted files from the previous revision', async () => {
  const files: ReviewFile[] = [
    {
      path: 'pkg/feature/calculate.py',
      state: 'modified',
      diff: '@@ -1,2 +1,2 @@\n from ..rates import lookup_rate\n-def calculate_total(): return lookup_rate(2)\n+def calculate_total(): return lookup_rate()',
    },
    { path: 'pkg/removed.py', state: 'deleted', diff: '@@ -1 +0,0 @@\n-def removed(): return 1' },
  ];
  const context = await collectReviewContext({
    current: snapshot({
      'pkg/feature/calculate.py':
        'from ..rates import lookup_rate\ndef calculate_total(): return lookup_rate()',
      'pkg/rates.py': 'def lookup_rate(value): return value.rate',
    }),
    before: snapshot({ 'pkg/removed.py': 'def removed(): return 1' }),
    files,
  });
  expect(context.report.files).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: 'pkg/rates.py', role: 'dependency' }),
      expect.objectContaining({ path: 'pkg/removed.py', side: 'before', role: 'changed' }),
    ]),
  );
});
it('does not read optional related files after the context budget is exhausted', async () => {
  const current = snapshot({
    'src/calculate.ts': 'export function calculateTotal() {}',
    'src/calculate.test.ts': 'calculateTotal();',
    'caller.ts': 'calculateTotal();',
  });
  const read = vi.spyOn(current, 'readFile');
  const context = await collectReviewContext({
    current,
    before: null,
    files: diff,
    maxCharacters: 0,
  });
  expect(read).not.toHaveBeenCalled();
  expect(context.sources).toEqual([]);
  expect(context.report.omittedCount).toBeGreaterThan(0);
});
it('prioritizes changed guidance files around their edited lines instead of using only their prologue', async () => {
  const text = Array.from(
    { length: 400 },
    (_, index) => `Documentation line ${index + 1}: ${'context '.repeat(4)}`,
  ).join('\n');
  const files: ReviewFile[] = [
    { path: 'README.md', state: 'modified', diff: '@@ -240,2 +240,2 @@\n-old\n+new' },
  ];
  const context = await collectReviewContext({
    current: snapshot({ 'README.md': text }),
    before: null,
    files,
  });
  expect(context.report.files[0]).toMatchObject({
    path: 'README.md',
    role: 'changed',
    side: 'current',
    complete: false,
  });
  expect(
    context.report.files[0].ranges.some((range) => range.startLine <= 240 && range.endLine >= 240),
  ).toBe(true);
});
