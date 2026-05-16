import { useMemo } from 'react';
import { DiffBlock } from './diff/DiffBlock';
import { parseDiff } from '../utils/diff-parser';

type FileState = 'untracked' | 'staged' | 'modified' | 'deleted' | 'committed';

export interface ReviewFile {
  path: string;
  state: FileState;
  diff: string;
}

export function ReviewView({ files, isLoading, error, onRetry }: { files: ReviewFile[]; isLoading: boolean; error?: Error | null; onRetry?: () => void; }) {
  const grouped = useMemo(() => {
    return files.reduce<Record<FileState, ReviewFile[]>>((acc, file) => {
      acc[file.state].push(file);
      return acc;
    }, { untracked: [], staged: [], modified: [], deleted: [], committed: [] });
  }, [files]);

  if (isLoading) {
    return <div className="flex-1 p-4 text-sm text-text-muted">Loading review diff...</div>;
  }

  if (error) {
    return (
      <div className="flex-1 p-4">
        <div className="rounded-lg border border-danger/30 bg-danger/10 p-4 text-sm">
          <div className="font-medium text-danger">Failed to load review diff</div>
          <div className="mt-1 text-text-muted">{error.message}</div>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-4 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-main transition-colors hover:bg-background"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  if (files.length === 0) {
    return <div className="flex-1 p-4 text-sm text-text-muted">No worktree changes.</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-8">
      {(Object.keys(grouped) as FileState[]).map((state) => {
        const entries = grouped[state];
        if (entries.length === 0) return null;

        return (
          <section key={state} className="space-y-4">
            <div className="flex items-center gap-3">
              <h3 className="text-xs font-bold uppercase tracking-widest text-text-muted">{state}</h3>
              <div className="h-px flex-1 bg-border/40" />
              <span className="text-[10px] font-mono text-text-muted/60">{entries.length} files</span>
            </div>
            <div className="space-y-6">
              {entries.map((file) => {
                const hunks = parseDiff(file.diff);
                return (
                  <DiffBlock
                    key={`${state}:${file.path}`}
                    path={file.path}
                    hunks={hunks}
                    onStage={file.state === 'modified' || file.state === 'untracked' ? () => { /* TODO: Implement staging */ } : undefined}
                    onRevert={file.state === 'modified' ? () => { /* TODO: Implement revert */ } : undefined}
                  />
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
