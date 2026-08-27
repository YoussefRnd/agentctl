import { useMemo } from 'react';
import { parseDiff } from '../../../shared/lib/diff-parser';
import { matchSorter } from 'match-sorter';
import type { ReviewFile, FileState } from '../components/ReviewHeader';
import type { ReviewScope } from './useReviewViewState';
import { filePathMatches } from '../lib/turnChanges';

export function useReviewDiffs(
  files: ReviewFile[],
  searchQuery: string,
  scope: ReviewScope = 'uncommitted',
  turnFiles?: Set<string>,
) {
  const activeFiles = useMemo(() => {
    if (scope === 'all_edits') {
      return files;
    }
    if (scope === 'this_turn') {
      if (!turnFiles || turnFiles.size === 0) {
        return files.filter((f) => f.state !== 'committed');
      }
      const turnList = Array.from(turnFiles);
      return files.filter((f) => {
        const base = f.path.split('/').pop();
        return (
          turnFiles.has(f.path) ||
          (base && turnFiles.has(base)) ||
          turnList.some((tf) => filePathMatches(f.path, tf))
        );
      });
    }
    return files.filter((f) => f.state !== 'committed');
  }, [files, scope, turnFiles]);

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
