import path from 'node:path';
import type {
  ReviewFile,
  ReviewContextFile,
  ReviewContextRole,
  ReviewContextReport,
} from '@agentctl/shared';
import type { RepositoryTextSnapshot, SnapshotTextFile } from './types.js';

export interface ReviewContextSource extends Omit<ReviewContextFile, 'ranges' | 'characters'> {
  excerpts: { startLine: number; endLine: number; text: string }[];
}
export interface ReviewContextBundle {
  sources: ReviewContextSource[];
  report: ReviewContextReport;
}
const extensions = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mts',
  '.cts',
  '.mjs',
  '.cjs',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.cs',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.rb',
  '.php',
  '.swift',
  '.kt',
  '.scala',
  '.vue',
  '.svelte',
];
const testPath = (file: string) =>
  /(?:^|\/)(?:__tests__|tests?|spec)(?:\/|$)|\.(?:test|spec)\.|(?:^|\/)test_|_test\./i.test(file);
const excluded = (file: string) =>
  /(?:^|\/)(?:secrets?|credentials)(?:\/|\.(?:json|ya?ml|toml|ini|env|txt)$|$)/i.test(file) ||
  /(?:^|\/)(?:node_modules|vendor|dist|build|target|coverage|\.git|\.venv|\.aws|\.ssh)(?:\/|$)|(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|\.pypirc|\.netrc|credentials(?:\.[^/]*)?|id_rsa|id_ed25519)$|\.(?:pem|key|p12|pfx|lock|map|min\.js)$/i.test(
    file,
  ) ||
  /(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock)$/.test(file);
const sourcePath = (file: string) => extensions.some((extension) => file.endsWith(extension));
const stem = (file: string) => path.posix.basename(file).replace(/\.[^.]+$/, '');

function termsIn(text: string, files: ReviewFile[]) {
  const symbols = [
    ...text.matchAll(/\b(?:function|class|def|fn|func|interface|type)\s+([A-Za-z_]\w{2,})/g),
  ].map((match) => match[1]);
  return [
    ...new Set([
      ...symbols,
      ...[...text.matchAll(/\b([A-Za-z_]\w{3,})\s*\(/g)].map((match) => match[1]),
      ...files.map((file) => stem(file.path)),
    ]),
  ]
    .filter(
      (term) =>
        ![
          'index',
          'main',
          'utils',
          'result',
          'value',
          'data',
          'options',
          'config',
          'error',
          'expect',
          'describe',
          'beforeEach',
          'afterEach',
          'require',
          'function',
          'return',
          'context',
          'source',
          'file',
          'files',
          'params',
          'prompt',
          'body',
          'request',
          'response',
          'string',
          'number',
          'undefined',
          'console',
        ].includes(term),
    )
    .slice(0, 24);
}
function importsIn(text: string) {
  return [
    ...new Set([
      ...[
        ...text.matchAll(
          /\b(?:from\s*|import\s*|require\s*\(\s*|include\s*)['"]([^'"\n]{1,200})['"]/g,
        ),
      ].map((match) => match[1]),
      ...[...text.matchAll(/^\s*from\s+([.\w]+)\s+import\b/gm)].map((match) =>
        match[1].startsWith('.')
          ? (match[1].match(/^\.+/)![0].length === 1
              ? './'
              : '../'.repeat(match[1].match(/^\.+/)![0].length - 1)) +
            match[1].replace(/^\.+/, '').replaceAll('.', '/')
          : match[1].replaceAll('.', '/'),
      ),
    ]),
  ].slice(0, 24);
}
function resolveImport(from: string, specifier: string, available: Set<string>) {
  const base = specifier.startsWith('.')
    ? path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier))
    : specifier.startsWith('@/')
      ? `src/${specifier.slice(2)}`
      : specifier;
  if (base.startsWith('../') || base.startsWith('/')) return undefined;
  const untyped = base.replace(/\.[cm]?js$/, '');
  const choices = [
    base,
    ...extensions.map((extension) => untyped + extension),
    ...extensions.map((extension) => base + '/index' + extension),
    base + '/__init__.py',
    base + '/mod.rs',
  ];
  return choices.find((choice) => available.has(choice));
}
function excerpts(text: string, target: number, anchors: number[]) {
  const lines = text.split('\n');
  const all = text.length <= target;
  const windows = all
    ? [[1, lines.length]]
    : (anchors.length ? anchors : [1])
        .slice(0, 4)
        .map((line) => [Math.max(1, line - 12), Math.min(lines.length, line + 24)]);
  const merged: number[][] = [];
  for (const [start, end] of windows.sort((a, b) => a[0] - b[0])) {
    if (start > lines.length || end < start) continue;
    const previous = merged.at(-1);
    if (previous && start <= previous[1] + 1) previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  }
  let remaining = target;
  const result: ReviewContextSource['excerpts'] = [];
  for (const [start, end] of merged) {
    const selected: string[] = [];
    for (let line = start; line <= end; line++) {
      const value = lines[line - 1];
      if (value.length + 1 > remaining) break;
      selected.push(value);
      remaining -= value.length + 1;
    }
    if (selected.length)
      result.push({
        startLine: start,
        endLine: start + selected.length - 1,
        text: selected.join('\n'),
      });
  }
  return {
    excerpts: result,
    complete: all && result.length === 1 && result[0].endLine === lines.length,
  };
}

/** Deterministic, provider-neutral retrieval from immutable snapshots, with explicit coverage. */
export async function collectReviewContext({
  current,
  before,
  files,
  maxCharacters = 36_000,
  signal,
}: {
  current: RepositoryTextSnapshot | null;
  before: RepositoryTextSnapshot | null;
  files: ReviewFile[];
  maxCharacters?: number;
  signal?: AbortSignal;
}): Promise<ReviewContextBundle> {
  const sources: ReviewContextSource[] = [];
  const report: ReviewContextReport = {
    version: 2,
    files: [],
    omitted: [],
    omittedCount: 0,
    limitations: [
      'Related-file selection uses imports, names and textual references, not a complete call graph.',
      'Included tests are source context only. Context retrieval does not execute commands; recorded verification evidence is separate.',
    ],
    indexedFiles: 0,
    indexTruncated: false,
    searchTruncated: false,
    inputCharacters: 0,
  };
  const omit = (file: string, side: 'before' | 'current', reason: string) => {
    report.omittedCount++;
    const entry = { path: file, side, reason };
    // Keep coverage metadata itself bounded, even for unusually long paths.
    if (report.omitted.length < 40 && JSON.stringify([...report.omitted, entry]).length <= 2400)
      report.omitted.push(entry);
  };
  if (!current) {
    report.limitations.push(
      'This repository cannot supply immutable source context. Only the captured diff was provided.',
    );
    return { sources, report };
  }
  let listing: Awaited<ReturnType<RepositoryTextSnapshot['listFiles']>>;
  try {
    listing = await current.listFiles(10_000, signal);
  } catch {
    listing = { files: [], truncated: true };
    report.limitations.push(
      'The source file index was unavailable; related-file discovery is incomplete.',
    );
  }
  report.indexedFiles = listing.files.length;
  report.indexTruncated = listing.truncated;
  if (listing.truncated)
    report.limitations.push(
      'The file index reached its limit; additional relevant files may exist.',
    );
  const allPaths = new Set(listing.files.map((file) => file.path));
  const available = new Set(
    listing.files
      .filter((file) => file.kind === 'file' && !excluded(file.path))
      .map((file) => file.path),
  );
  const seen = new Set<string>();
  const cached = new Map<string, Promise<SnapshotTextFile>>();
  const read = (file: string, side: 'before' | 'current') => {
    const key = `${side}:${file}`;
    let value = cached.get(key);
    if (!value) {
      const reader = side === 'current' ? current : before;
      value =
        reader && !signal?.aborted
          ? reader.readFile(file, 128 * 1024, signal).catch(() => ({ status: 'missing' as const }))
          : Promise.resolve({ status: 'missing' as const });
      cached.set(key, value);
    }
    return value;
  };
  const sourceBudget = Math.max(0, maxCharacters - 4500);
  const quota = {
    guidance: Math.min(4000, sourceBudget * 0.1),
    changed: sourceBudget * 0.4,
    dependency: sourceBudget * 0.2,
    test: sourceBudget * 0.15,
    reference: sourceBudget * 0.15,
  };
  const used = { guidance: 0, changed: 0, dependency: 0, test: 0, reference: 0 };
  let total = 0;
  const add = async (
    file: string,
    side: 'before' | 'current',
    role: ReviewContextRole,
    anchors: number[] | 'references' = [],
    allowance = 6500,
  ) => {
    const key = `${side}:${file}`;
    if (seen.has(key)) return;
    if (signal?.aborted) {
      omit(file, side, 'Context collection interrupted or timed out');
      return;
    }
    seen.add(key);
    if (excluded(file)) {
      omit(file, side, 'Sensitive or generated file excluded');
      return;
    }
    const room = Math.floor(Math.min(allowance, quota[role] - used[role], sourceBudget - total));
    if (sources.length >= 40 || room < 250) {
      omit(file, side, 'Context budget reached');
      return;
    }
    const content = await read(file, side);
    if (content.status !== 'text') {
      omit(
        file,
        side,
        {
          missing: 'Source unavailable',
          too_large: 'File exceeds the source read limit',
          binary: 'Binary file',
          symlink: 'Symlink target not followed',
          submodule: 'Nested repository not inspected',
        }[content.status],
      );
      return;
    }
    const positions =
      anchors === 'references'
        ? content.text
            .split('\n')
            .flatMap((line, index) =>
              terms.some((term) => line.includes(term)) ? [index + 1] : [],
            )
            .slice(0, 4)
        : anchors;
    let target = Math.max(0, room - 300);
    let source: ReviewContextSource;
    let encoded: number;
    do {
      const selection = excerpts(content.text, target, positions);
      source = { path: file, side, role, ...selection };
      encoded = JSON.stringify(source).length;
      target = Math.floor(target * 0.7);
    } while (encoded > room && target > 0);
    if (!source.excerpts.length || encoded > room) {
      omit(file, side, 'Context budget reached');
      return;
    }
    sources.push(source);
    total += encoded;
    used[role] += encoded;
  };
  const guidance = ['REVIEW.md', 'AGENTS.md', 'README.md'];
  for (const file of guidance)
    if (allPaths.has(file) && !files.some((changed) => changed.path === file))
      await add(file, 'current', 'guidance', [], 2200);
  const currentText: { file: string; text: string }[] = [];
  const changed = files.slice(0, 100);
  for (const file of changed) {
    const side = file.state === 'deleted' ? 'before' : 'current';
    const anchors = [...file.diff.matchAll(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/gm)].map(
      (match) => Number(match[side === 'before' ? 1 : 2]),
    );
    await add(file.path, side, 'changed', anchors);
    const content = cached.get(`${side}:${file.path}`);
    if (content && !excluded(file.path)) {
      const value = await content;
      if (value.status === 'text') currentText.push({ file: file.path, text: value.text });
    }
  }
  const dependencies = new Set<string>();
  for (const source of currentText)
    for (const specifier of importsIn(source.text)) {
      const dependency = resolveImport(source.file, specifier, allPaths);
      if (dependency) dependencies.add(dependency);
    }
  const terms = termsIn(changed.map((file) => file.diff).join('\n'), changed);
  for (const file of [...dependencies].slice(0, 12))
    await add(file, 'current', testPath(file) ? 'test' : 'dependency', 'references');
  let references: string[] = [];
  if (current.search && terms.length && !signal?.aborted) {
    try {
      const matches = await current.search(terms, 100, signal);
      references = matches.paths.filter((file) => available.has(file) && sourcePath(file));
      report.searchTruncated = matches.truncated;
      if (matches.truncated)
        report.limitations.push(
          'Reference search reached its match limit; additional callers or tests may exist.',
        );
    } catch {
      report.searchTruncated = true;
      report.limitations.push(
        'Reference search was unavailable; callers could not be fully discovered.',
      );
    }
  } else
    report.limitations.push(
      'No reference search was available for this change; caller discovery is limited.',
    );
  const stems = changed
    .map((file) => stem(file.path))
    .filter((name) => name.length > 2 && name !== 'index');
  const tests = [
    ...new Set([
      ...listing.files
        .map((file) => file.path)
        .filter(
          (file) =>
            available.has(file) &&
            testPath(file) &&
            stems.some((name) => path.posix.basename(file).includes(name)),
        ),
      ...references.filter(testPath),
    ]),
  ];
  for (const file of tests.slice(0, 12))
    await add(file, 'current', 'test', terms.length ? 'references' : []);
  const callers = references.filter(
    (file) => !testPath(file) && !files.some((changed) => changed.path === file),
  );
  for (const file of callers.slice(0, 12)) await add(file, 'current', 'reference', 'references');
  if (tests.length > 12 || callers.length > 12 || dependencies.size > 12)
    report.limitations.push(
      'Related-file candidate limits were reached; the supplied context is not exhaustive.',
    );
  for (const file of changed
    .filter((file) => file.state !== 'untracked' && file.state !== 'deleted')
    .slice(0, 12)) {
    const anchors = [...file.diff.matchAll(/^@@ -(\d+)/gm)].map((match) => Number(match[1]));
    await add(file.path, 'before', 'changed', anchors, 3000);
  }
  report.files = sources.map(({ excerpts, ...source }) => ({
    ...source,
    ranges: excerpts.map(({ startLine, endLine }) => ({ startLine, endLine })),
    characters: excerpts.reduce((sum, excerpt) => sum + excerpt.text.length, 0),
  }));
  if (!sources.some((source) => source.role === 'test' || testPath(source.path)))
    report.limitations.push('No related test source was supplied; test coverage was not assessed.');
  if (signal?.aborted)
    report.limitations.push(
      'Context collection reached its time limit; additional context could not be assessed.',
    );
  if (sources.some((source) => !source.complete))
    report.limitations.push(
      'Some source files are supplied as excerpts; unlisted lines were not provided.',
    );
  if (report.omittedCount)
    report.limitations.push(
      'Some candidate files were excluded or omitted. Review the coverage list before relying on this result.',
    );
  if (!sources.length)
    report.limitations.push(
      'No supplemental source content fit this review. Only the captured diff was provided.',
    );
  return { sources, report };
}
