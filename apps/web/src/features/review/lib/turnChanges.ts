import type { SessionEventRow } from '@agentctl/shared';
import {
  isSessionEventToolCall,
  structuredDiffSchema,
  normalizeFileChanges,
  fileChangeStatsSchema,
  type SessionEventToolCallData,
} from '@agentctl/shared';
import { parseDiff } from '@/shared/lib/diff-parser';
import type { ReviewFile } from '../ui/ReviewHeader';

export interface TurnFileChange {
  path: string;
  additions: number;
  deletions: number;
  status?: 'modified' | 'added' | 'deleted';
}

export interface TurnChangesSummary {
  files: TurnFileChange[];
  totalAdditions: number;
  totalDeletions: number;
}

/**
 * Normalizes a relative file path (removes leading slashes, quotes, ./, etc.)
 */
export function normalizeFilePath(rawPath: string): string {
  if (!rawPath) return '';
  let p = rawPath
    .trim()
    .replace(/^[`'"]+|[`'"]+$/g, '')
    .replace(/\\/g, '/');
  if (p.startsWith('./')) p = p.substring(2);
  if (p.startsWith('/')) p = p.substring(1);
  return p;
}

/**
 * Checks if two file path strings point to the same file.
 */
export function filePathMatches(pathA: string, pathB: string): boolean {
  const a = normalizeFilePath(pathA);
  const b = normalizeFilePath(pathB);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.endsWith('/' + b) || b.endsWith('/' + a);
}

/**
 * Resolves touched paths to review files without guessing when a short path is ambiguous.
 */
export function resolveTurnReviewFiles(
  reviewFiles: ReviewFile[],
  touchedPaths: Iterable<string>,
): Set<string> {
  const resolved = new Set<string>();

  for (const touchedPath of touchedPaths) {
    const matches = reviewFiles.filter((file) => filePathMatches(file.path, touchedPath));
    if (matches.length === 1) {
      resolved.add(matches[0].path);
      continue;
    }

    const normalizedTouchedPath = normalizeFilePath(touchedPath);
    const exactMatch = matches.find(
      (file) => normalizeFilePath(file.path) === normalizedTouchedPath,
    );
    if (exactMatch) {
      resolved.add(exactMatch.path);
    }
  }

  return resolved;
}

/**
 * Extracts a file path from a tool call's explicit arguments, locations, content, or rawOutput metadata.
 */
export function extractFilePathFromToolCall(data: Record<string, unknown>): string | null {
  // 1. Product-normalized effects
  if (Array.isArray(data.effects)) {
    const effect = data.effects.find(
      (candidate): candidate is { type: string; path: string } =>
        typeof candidate === 'object' &&
        candidate !== null &&
        'path' in candidate &&
        typeof candidate.path === 'string',
    );
    if (effect?.path.trim()) return normalizeFilePath(effect.path);
  }

  // 2. Standard locations
  if (Array.isArray(data.locations) && data.locations.length > 0) {
    const first = data.locations[0] as { path?: string };
    if (typeof first?.path === 'string' && first.path.trim()) {
      return normalizeFilePath(first.path);
    }
  }

  // 3. Content diff or path
  if (Array.isArray(data.content)) {
    for (const c of data.content as { path?: string; type?: string }[]) {
      if (typeof c?.path === 'string' && c.path.trim()) {
        return normalizeFilePath(c.path);
      }
    }
  }

  // 4. RawOutput metadata (filepath, filediff, display path)
  const rawOut = data.rawOutput as Record<string, unknown> | undefined;
  if (rawOut && typeof rawOut === 'object') {
    const meta = rawOut.metadata as Record<string, unknown> | undefined;
    if (meta && typeof meta === 'object') {
      if (typeof meta.filepath === 'string' && meta.filepath.trim()) {
        return normalizeFilePath(meta.filepath);
      }
      const filediff = meta.filediff as { file?: string } | undefined;
      if (typeof filediff?.file === 'string' && filediff.file.trim()) {
        return normalizeFilePath(filediff.file);
      }
      const display = meta.display as { path?: string } | undefined;
      if (typeof display?.path === 'string' && display.path.trim()) {
        return normalizeFilePath(display.path);
      }
    }
  }

  // 5. Explicit tool arguments (handling nested arguments)
  const sources: Record<string, unknown>[] = [];
  if (data.arguments && typeof data.arguments === 'object') {
    sources.push(data.arguments as Record<string, unknown>);
    const nested = (data.arguments as Record<string, unknown>).arguments;
    if (nested && typeof nested === 'object') sources.push(nested as Record<string, unknown>);
  }
  if (data.rawInput && typeof data.rawInput === 'object') {
    sources.push(data.rawInput as Record<string, unknown>);
    const nested = (data.rawInput as Record<string, unknown>).arguments;
    if (nested && typeof nested === 'object') sources.push(nested as Record<string, unknown>);
  }

  for (const src of sources) {
    const directCandidates = [
      src.targetFile,
      src.TargetFile,
      src.filePath,
      src.FilePath,
      src.file_path,
      src.path,
      src.Path,
      src.file,
      src.filename,
      src.uri,
      src.file_uri,
      src.target_file,
      src.AbsolutePath,
      src.absolutePath,
      src.newPath,
      src.new_path,
      src.destination,
    ];
    for (const cand of directCandidates) {
      if (typeof cand === 'string' && cand.trim().length > 0) {
        return normalizeFilePath(cand);
      }
    }
  }

  // 6. Name when the tool itself is directly named after the file path
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (name && (name.includes('/') || /\.[a-zA-Z0-9_-]{1,10}$/.test(name)) && !name.includes(' ')) {
    return normalizeFilePath(name);
  }

  return null;
}

/**
 * Checks if a tool call is an edit / write / creation file modification action.
 */
export function isFileModificationToolCall(data: {
  name?: string;
  kind?: string;
  title?: string | null;
  content?: unknown[];
  arguments?: Record<string, unknown>;
  rawInput?: unknown;
  rawOutput?: unknown;
  effects?: { type: string; path?: string }[];
}): boolean {
  if (
    data.effects?.some(
      (effect) => effect.type === 'file_modified' || effect.type === 'file_deleted',
    )
  ) {
    return true;
  }
  if (data.effects?.some((effect) => effect.type === 'file_read')) return false;

  const name = (data.name ?? '').toLowerCase();
  const kind = (data.kind ?? '').toLowerCase();
  const title = (data.title ?? '').toLowerCase();

  // 1. Explicitly ignore execution, read, and search tool calls
  if (
    kind === 'execute' ||
    kind === 'terminal' ||
    kind === 'read' ||
    kind === 'search' ||
    kind === 'fetch'
  ) {
    return false;
  }

  if (
    name.includes('command') ||
    name.includes('bash') ||
    name.includes('exec') ||
    name.includes('terminal') ||
    name.includes('grep') ||
    name.includes('search') ||
    name.includes('find') ||
    name.includes('read') ||
    name.includes('view')
  ) {
    return false;
  }

  // 2. Direct modification kinds
  if (kind === 'edit' || kind === 'delete' || kind === 'create') return true;

  if (
    name.includes('edit') ||
    name.includes('write') ||
    name.includes('create') ||
    name.includes('replace') ||
    name.includes('delete') ||
    name.includes('patch') ||
    name.includes('save')
  ) {
    return true;
  }

  if (
    title.includes('create') ||
    title.includes('edit') ||
    title.includes('write') ||
    title.includes('delete') ||
    title.includes('update') ||
    title.includes('modify')
  ) {
    return true;
  }

  // Check rawOutput for write / edit indicators
  const rawOut = data.rawOutput as Record<string, unknown> | undefined;
  if (rawOut && typeof rawOut === 'object') {
    const meta = rawOut.metadata as Record<string, unknown> | undefined;
    if (meta && typeof meta === 'object') {
      if (meta.diff || meta.filediff || (meta.filepath && meta.exists === false)) {
        return true;
      }
      const display = meta.display as { type?: string } | undefined;
      if (display?.type === 'file') {
        return false;
      }
    }

    const outStr = typeof rawOut.output === 'string' ? rawOut.output.toLowerCase() : '';
    if (outStr.trim().startsWith('<path>') && outStr.includes('<content>')) {
      return false;
    }

    if (
      outStr.includes('wrote file') ||
      outStr.includes('edit applied') ||
      outStr.includes('file created') ||
      outStr.includes('created file') ||
      outStr.includes('file deleted') ||
      outStr.includes('deleted file') ||
      outStr.includes('file saved') ||
      outStr.includes('saved file') ||
      outStr.includes('patch applied') ||
      outStr.includes('changes applied')
    ) {
      return true;
    }
  }

  // Check content messages
  if (Array.isArray(data.content)) {
    for (const c of data.content as {
      type?: string;
      content?: { text?: string };
    }[]) {
      if (c.type === 'diff') return true;
      const text = c.content?.text?.toLowerCase() ?? '';
      if (
        text.includes('wrote file') ||
        text.includes('edit applied') ||
        text.includes('file created') ||
        text.includes('created file') ||
        text.includes('file deleted') ||
        text.includes('deleted file') ||
        text.includes('patch applied') ||
        text.includes('changes applied')
      ) {
        return true;
      }
    }
  }

  return false;
}

function fileChangeReports(data: SessionEventToolCallData): SessionEventToolCallData[] {
  const diffs = (data.content ?? []).flatMap((content) => {
    if (content.type !== 'diff') return [];
    const parsed = structuredDiffSchema.safeParse(content);
    return parsed.success ? [parsed.data] : [];
  });
  if (!diffs.length) return [data];
  return diffs.flatMap((diff) =>
    normalizeFileChanges(diff).map(({ path, operation, stats }) => ({
      toolCallId: data.toolCallId,
      status: data.status,
      name: operation === 'add' ? 'create' : operation,
      kind: operation === 'delete' ? 'delete' : 'edit',
      locations: [{ path }],
      effects: [
        {
          type: operation === 'delete' ? 'file_deleted' : 'file_modified',
          path,
          ...(stats ? { stats } : {}),
        },
      ],
    })),
  );
}

/**
 * Calculates diff additions and deletions for a given review file.
 */
export function getDiffStats(diffText: string): { additions: number; deletions: number } {
  if (!diffText) return { additions: 0, deletions: 0 };
  const hunks = parseDiff(diffText, { highlightWords: false });
  let additions = 0;
  let deletions = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'added') additions++;
      else if (line.type === 'removed') deletions++;
    }
  }
  return { additions, deletions };
}

function getToolCallStats(data: Record<string, unknown>): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;

  const reported = Array.isArray(data.effects)
    ? data.effects.flatMap((effect) => {
        const stats = fileChangeStatsSchema.safeParse(
          effect && typeof effect === 'object' ? effect.stats : undefined,
        );
        return stats.success ? [stats.data] : [];
      })
    : [];
  if (reported.length)
    return reported.reduce(
      (sum, effect) => ({
        additions: sum.additions + effect.additions,
        deletions: sum.deletions + effect.deletions,
      }),
      { additions: 0, deletions: 0 },
    );

  if (Array.isArray(data.effects)) {
    for (const effect of data.effects as {
      type?: string;
      oldText?: string | null;
      newText?: string;
    }[]) {
      if (effect.type !== 'file_modified') continue;
      if (effect.newText) additions += effect.newText.split('\n').length;
      if (effect.oldText) deletions += effect.oldText.split('\n').length;
    }
  }

  if (additions > 0 || deletions > 0) return { additions, deletions };

  if (Array.isArray(data.content)) {
    for (const item of data.content as {
      type?: string;
      oldText?: string | null;
      newText?: string;
    }[]) {
      if (item.type !== 'diff') continue;
      if (typeof item.newText === 'string' && item.newText.length > 0) {
        additions += item.newText.split('\n').length;
      }
      if (typeof item.oldText === 'string' && item.oldText.length > 0) {
        deletions += item.oldText.split('\n').length;
      }
    }
  }

  if (additions > 0 || deletions > 0) {
    return { additions, deletions };
  }

  const args = (data.arguments || data.rawInput) as Record<string, unknown> | undefined;
  if (!args) return { additions, deletions };

  const replacement = args.ReplacementContent as string | undefined;
  const target = args.TargetContent as string | undefined;
  if (typeof replacement === 'string' && typeof target === 'string') {
    return {
      additions: replacement.length > 0 ? replacement.split('\n').length : 0,
      deletions: target.length > 0 ? target.split('\n').length : 0,
    };
  }

  const codeContent =
    (args.CodeContent as string) ||
    (args.codeContent as string) ||
    (args.content as string) ||
    (args.text as string);
  if (typeof codeContent === 'string' && codeContent.length > 0) {
    additions = codeContent.split('\n').length;
  }

  return { additions, deletions };
}

/**
 * Extracts all file changes made in a specific group of events (an agent response turn),
 * using tool-local stats when available and the current review diff as a fallback.
 */
export function extractTurnChanges(
  events: SessionEventRow[],
  reviewFiles?: ReviewFile[],
): TurnChangesSummary {
  // 1. Prioritize server-computed turn changes from SnapshotService if present
  for (const event of events) {
    if (event.type === 'status' && event.data) {
      const serverTurnChanges = (event.data as { turnChanges?: TurnChangesSummary }).turnChanges;
      if (
        serverTurnChanges &&
        Array.isArray(serverTurnChanges.files) &&
        typeof serverTurnChanges.totalAdditions === 'number' &&
        typeof serverTurnChanges.totalDeletions === 'number'
      ) {
        return serverTurnChanges;
      }
    }
  }

  // 2. Client fallback
  const fileMap = new Map<string, TurnFileChange & { hasTurnLocalStats: boolean }>();

  for (const event of events) {
    if (!isSessionEventToolCall(event)) continue;

    for (const data of fileChangeReports(event.data)) {
      if (!isFileModificationToolCall(data)) continue;

      const filePath = extractFilePathFromToolCall(data);
      if (!filePath) continue;

      let { additions, deletions } = getToolCallStats(data);
      const hasTurnLocalStats =
        additions > 0 ||
        deletions > 0 ||
        data.effects?.some((effect) => 'stats' in effect) === true;
      let matchedReviewPath = filePath;
      let status: 'modified' | 'added' | 'deleted' =
        data.effects?.some((effect) => effect.type === 'file_deleted') ||
        data.kind === 'delete' ||
        data.name?.toLowerCase().includes('delete')
          ? 'deleted'
          : data.name?.toLowerCase().includes('create')
            ? 'added'
            : 'modified';

      // Cross-reference with live review files if provided
      if (reviewFiles && reviewFiles.length > 0) {
        const [matchedPath] = resolveTurnReviewFiles(reviewFiles, [filePath]);
        const match = matchedPath
          ? reviewFiles.find((reviewFile) => reviewFile.path === matchedPath)
          : undefined;
        if (match) {
          matchedReviewPath = match.path;
          status =
            match.state === 'untracked'
              ? 'added'
              : match.state === 'deleted'
                ? 'deleted'
                : 'modified';
          if (!hasTurnLocalStats) {
            const stats =
              match.additions !== undefined && match.deletions !== undefined
                ? { additions: match.additions, deletions: match.deletions }
                : getDiffStats(match.diff);
            additions = stats.additions;
            deletions = stats.deletions;
          }
        }
      }

      const existing = fileMap.get(matchedReviewPath);
      if (existing) {
        if (hasTurnLocalStats && existing.hasTurnLocalStats) {
          existing.additions += additions;
          existing.deletions += deletions;
        } else if (hasTurnLocalStats) {
          existing.additions = additions;
          existing.deletions = deletions;
          existing.hasTurnLocalStats = true;
        } else if (!existing.hasTurnLocalStats) {
          existing.additions = Math.max(existing.additions, additions);
          existing.deletions = Math.max(existing.deletions, deletions);
        }
      } else {
        fileMap.set(matchedReviewPath, {
          path: matchedReviewPath,
          additions,
          deletions,
          status,
          hasTurnLocalStats,
        });
      }
    }
  }

  const files = Array.from(fileMap.values(), ({ path, additions, deletions, status }) => ({
    path,
    additions,
    deletions,
    status,
  }));
  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  return {
    files,
    totalAdditions,
    totalDeletions,
  };
}

/**
 * Extracts the set of file paths modified during the latest agent prompt turn.
 */
export function extractLatestTurnTouchedFiles(events: SessionEventRow[]): Set<string> {
  const set = new Set<string>();
  let lastUserIdx = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'text' && (e.data as { role?: string })?.role === 'user') {
      lastUserIdx = i;
      break;
    }
  }

  const turnEvents = lastUserIdx >= 0 ? events.slice(lastUserIdx) : events;
  for (const e of turnEvents) {
    if (isSessionEventToolCall(e)) {
      for (const data of fileChangeReports(e.data)) {
        if (!isFileModificationToolCall(data)) continue;
        const path = extractFilePathFromToolCall(data);
        if (path) set.add(path);
      }
    }
  }
  return set;
}
