import { useMemo } from 'react';

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
    <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4">
      {(Object.keys(grouped) as FileState[]).map((state) => {
        const entries = grouped[state];
        if (entries.length === 0) return null;

        return (
          <section key={state} className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted">{state}</h3>
            <div className="space-y-3">
              {entries.map((file) => (
                <article key={`${state}:${file.path}`} className="rounded border border-border bg-surface/60 p-3">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="font-mono text-sm text-text-main break-all">{file.path}</div>
                    <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-text-muted">
                      {file.state}
                    </span>
                  </div>
                  <pre className="overflow-x-auto whitespace-pre-wrap text-xs leading-5 text-text-muted">{file.diff}</pre>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
