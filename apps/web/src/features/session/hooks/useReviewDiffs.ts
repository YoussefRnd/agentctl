import { useMemo } from 'react';
import { parseDiff } from '../../../shared/lib/diff-parser';
import { matchSorter } from 'match-sorter';
import type { ReviewFile, FileState } from '../components/ReviewHeader';
import type { ReviewScope } from '@/shared';
import type { StatusFilter } from './useReviewViewState';

export function useReviewDiffs(
  files: ReviewFile[],
  searchQuery: string,
  scope: ReviewScope = 'uncommitted',
  turnFiles?: Set<string>,
  statusFilter: StatusFilter = 'all',
) {
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
      list = list.filter((f) => f.state === statusFilter);
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
    return filteredFiles.map((file) => ({
      ...file,
      hunks: parseDiff(file.diff),
    }));
  }, [filteredFiles]);

  const grouped = useMemo(() => {
    const initial: Record<FileState, (ReviewFile & { hunks: ReturnType<typeof parseDiff> })[]> = {
      conflicted: [],
      untracked: [],
      staged: [],
      modified: [],
      deleted: [],
      committed: [],
    };
    return parsedFiles.reduce((acc, file) => {
      acc[file.state].push(file);
      return acc;
    }, initial);
  }, [parsedFiles]);

  const fileStats = useMemo(() => {
    const map = new Map<string, { additions: number; deletions: number }>();
    parsedFiles.forEach((file) => {
      let additions = 0;
      let deletions = 0;
      file.hunks.forEach((hunk) => {
        hunk.lines.forEach((line) => {
          if (line.type === 'added') additions++;
          else if (line.type === 'removed') deletions++;
        });
      });
      map.set(file.path, { additions, deletions });
    });
    return map;
  }, [parsedFiles]);

  return { activeFiles, filteredFiles, parsedFiles, grouped, fileStats };
}
