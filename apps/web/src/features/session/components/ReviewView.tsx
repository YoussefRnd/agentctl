import { useMemo } from 'react';
import { DiffBlock } from './diff/DiffBlock';
import { parseDiff } from '../../../utils/diff-parser';

type FileState = 'untracked' | 'staged' | 'modified' | 'deleted' | 'committed';

export interface ReviewFile {
  path: string;
  state: FileState;
  diff: string;
}

export function ReviewView({
  files,
  isLoading,
  error,
  onRetry,
}: {
  files: ReviewFile[];
  isLoading: boolean;
  error?: Error | null;
  onRetry?: () => void;
}) {
  const grouped = useMemo(() => {
    return files.reduce<Record<FileState, ReviewFile[]>>(
      (acc, file) => {
        acc[file.state].push(file);
        return acc;
      },
      { untracked: [], staged: [], modified: [], deleted: [], committed: [] },
    );
  }, [files]);

  if (isLoading) {
    return <div className="text-text-muted flex-1 p-4 text-sm">Loading review diff...</div>;
  }

  if (error) {
    return (
      <div className="flex-1 p-4">
        <div className="border-danger/30 bg-danger/10 rounded-lg border p-4 text-sm">
          <div className="text-danger font-medium">Failed to load review diff</div>
          <div className="text-text-muted mt-1">{error.message}</div>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="border-border bg-surface text-text-main hover:bg-background mt-4 rounded-lg border px-3 py-2 text-sm transition-colors"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  if (files.length === 0) {
    return <div className="text-text-muted flex-1 p-4 text-sm">No worktree changes.</div>;
  }

  const activeStates = (Object.keys(grouped) as FileState[]).filter(
    (state) => grouped[state].length > 0,
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="bg-surface/30 border-border shrink-0 border-b p-4 shadow-sm backdrop-blur-xl">
        <h2 className="font-display text-text-main mb-4 text-lg font-medium">Code Review</h2>
        <div className="flex flex-wrap gap-6">
          {activeStates.map((state) => (
            <div key={state} className="flex flex-col gap-1">
              <span className="text-text-muted/70 text-[10px] font-black tracking-[0.15em] uppercase">
                {state}
              </span>
              <span className="text-text-main font-mono text-xl font-medium">
                {grouped[state].length}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex-1 space-y-8 overflow-y-auto p-3 sm:p-4">
        {activeStates.map((state) => {
          const entries = grouped[state];

          return (
            <section key={state} className="space-y-4">
              <div className="flex items-center gap-3">
                <h3 className="text-text-muted text-xs font-bold tracking-widest uppercase">
                  {state}
                </h3>
                <div className="bg-border/40 h-px flex-1" />
                <span className="text-text-muted/60 font-mono text-[10px]">
                  {entries.length} files
                </span>
              </div>
              <div className="space-y-6">
                {entries.map((file) => {
                  const hunks = parseDiff(file.diff);
                  return (
                    <DiffBlock
                      key={`${state}:${file.path}`}
                      path={file.path}
                      hunks={hunks}
                      onStage={
                        file.state === 'modified' || file.state === 'untracked'
                          ? () => {
                              /* TODO: Implement staging */
                            }
                          : undefined
                      }
                      onRevert={
                        file.state === 'modified'
                          ? () => {
                              /* TODO: Implement revert */
                            }
                          : undefined
                      }
                    />
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
