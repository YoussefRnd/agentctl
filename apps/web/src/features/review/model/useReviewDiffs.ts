import { useMemo, useRef } from 'react';
import { parseDiff } from '@/shared/lib/diff-parser';
import { matchSorter } from 'match-sorter';
import type { ReviewFile } from '../ui/ReviewHeader';
import type { ReviewScope } from './useReviewUIStore';
import type { StatusFilter } from './useReviewViewState';

export function useReviewDiffs(
  files: ReviewFile[],
  searchQuery: string,
  scope: ReviewScope = 'uncommitted',
  turnFiles?: Set<string>,
  statusFilter: StatusFilter = 'all',
  visibleFiles?: Set<string>,
  collapsedFiles?: Record<string, boolean>,
) {
  const parsedCache = useRef(
    new Map<string, { diff: string; hunks: ReturnType<typeof parseDiff> }>(),
  );
  const activeFiles = useMemo(() => {
    let list = files;
    if (scope === 'all_edits') {
      list = files;
    } else if (scope === 'this_turn') {
      list = turnFiles ? files.filter((file) => turnFiles.has(file.path)) : [];
    } else {
      list = files.filter((f) => f.state !== 'committed');
    }

    if (statusFilter !== 'all') {
      list = list.filter((f) =>
        statusFilter === 'staged'
          ? (f.hasStagedChanges ?? f.state === 'staged')
          : f.state === statusFilter,
      );
    }
    return list;
  }, [files, scope, turnFiles, statusFilter]);

  const filteredFiles = useMemo(() => {
    if (!searchQuery) return activeFiles;
    return matchSorter(activeFiles, searchQuery, {
      keys: ['path', 'diff'],
      threshold: matchSorter.rankings.CONTAINS,
    });
  }, [activeFiles, searchQuery]);

  const parsedFiles = useMemo(() => {
    const parsed = filteredFiles.map((file) => {
      if (
        (visibleFiles && !visibleFiles.has(file.path)) ||
        (collapsedFiles && collapsedFiles[file.path] !== false)
      ) {
        return { ...file, diff: '', hunks: [] };
      }
      let cached = parsedCache.current.get(file.path);
      if (!cached || cached.diff !== file.diff) {
        cached = { diff: file.diff, hunks: parseDiff(file.diff) };
        parsedCache.current.set(file.path, cached);
      }
      return { ...file, hunks: cached.hunks };
    });
    for (const filePath of parsedCache.current.keys()) {
      if (visibleFiles && !visibleFiles.has(filePath)) parsedCache.current.delete(filePath);
    }
    return parsed;
  }, [filteredFiles, visibleFiles, collapsedFiles]);

  const fileStats = useMemo(() => {
    const map = new Map<string, { additions: number; deletions: number }>();
    filteredFiles.forEach((file) => {
      let additions = 0;
      let deletions = 0;
      if (file.additions === undefined || file.deletions === undefined)
        parseDiff(file.diff, { highlightWords: false }).forEach((hunk) => {
          hunk.lines.forEach((line) => {
            if (line.type === 'added') additions++;
            else if (line.type === 'removed') deletions++;
          });
        });
      map.set(file.path, {
        additions: file.additions ?? additions,
        deletions: file.deletions ?? deletions,
      });
    });
    return map;
  }, [filteredFiles]);

  return { activeFiles, filteredFiles, parsedFiles, fileStats };
}
