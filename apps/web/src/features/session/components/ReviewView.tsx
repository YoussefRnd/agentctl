import { useMemo } from 'react';
import { DiffBlock } from './diff/DiffBlock';
import { parseDiff } from '../../../utils/diff-parser';
import { Button } from '@agentctl/ui';

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
  onStage,
  onRevert,
  sessionStatus,
  onMerge,
  onDiscard,
  isMerging,
  isDiscarding,
  taskSlug,
}: {
  files: ReviewFile[];
  isLoading: boolean;
  error?: Error | null;
  onRetry?: () => void;
  onStage?: (filePath: string) => void;
  onRevert?: (filePath: string) => void;
  sessionStatus?: string;
  onMerge?: (commitMessage?: string) => void;
  onDiscard?: () => void;
  isMerging?: boolean;
  isDiscarding?: boolean;
  taskSlug?: string;
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

  const isClosed = sessionStatus === 'merged' || sessionStatus === 'discarded';

  if (isClosed) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
        <div className="rounded-full bg-surface-secondary/50 p-4 mb-4 border border-border/40">
          <span className="text-[24px]">
            {sessionStatus === 'merged' ? '✅' : '🗑️'}
          </span>
        </div>
        <h3 className="text-[12px] font-black tracking-widest text-text-main uppercase mb-1">
          SESSION_{sessionStatus.toUpperCase()}
        </h3>
        <p className="text-[10px] text-text-muted max-w-[240px] leading-relaxed uppercase">
          This session has been finalized. All changes have been {sessionStatus === 'merged' ? 'merged into the main branch' : 'discarded'}.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="text-text-muted animate-pulse p-4 text-[10px] font-bold uppercase">
        Scanning changes...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 p-2">
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-[11px]">
          <div className="font-bold text-danger uppercase">Critical Error</div>
          <div className="text-danger/80 mt-1 tracking-tighter uppercase">{error.message}</div>
          {onRetry && (
            <Button type="button" onClick={onRetry} className="mt-4 h-8 px-4 text-[10px] tracking-widest font-bold">
              RETRY_SCAN
            </Button>
          )}
        </div>
      </div>
    );
  }

  const activeStates = (Object.keys(grouped) as FileState[]).filter(
    (state) => grouped[state].length > 0,
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-border/50 shrink-0 border-b p-3 bg-surface-secondary/10">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[11px] font-black tracking-[0.2em] text-text-main uppercase">
            CODE_REVIEW_MANIFEST
          </h2>
          <div className="flex gap-1.5">
            <Button
              disabled={!!isMerging || !!isDiscarding}
              onClick={() => {
                const msg = window.prompt('Enter commit message (optional):', taskSlug ?? '');
                if (msg !== null && onMerge) {
                  onMerge(msg);
                }
              }}
              className="h-7 px-3 bg-brand-green text-brand-crust hover:opacity-90 disabled:opacity-30 text-[9px] font-bold tracking-widest uppercase rounded-lg cursor-pointer"
            >
              {isMerging ? 'MERGING...' : 'MERGE'}
            </Button>
            <Button
              disabled={!!isMerging || !!isDiscarding}
              onClick={() => {
                if (
                  window.confirm(
                    'Are you sure you want to discard all changes? This cannot be undone.'
                  ) &&
                  onDiscard
                ) {
                  onDiscard();
                }
              }}
              className="h-7 px-3 bg-brand-red text-brand-crust hover:opacity-90 disabled:opacity-30 text-[9px] font-bold tracking-widest uppercase rounded-lg cursor-pointer"
            >
              {isDiscarding ? 'DISCARDING...' : 'DISCARD'}
            </Button>
          </div>
        </div>
        {files.length > 0 && (
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {activeStates.map((state) => (
              <div key={state} className="flex items-baseline gap-2">
                <span className="text-[9px] font-black tracking-widest text-text-muted/40 uppercase">
                  {state}
                </span>
                <span className="text-[16px] font-black text-text-main tabular-nums">
                  {grouped[state].length}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      {files.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-6 text-center opacity-30">
          <div className="text-text-muted text-[10px] font-bold uppercase">
            Worktree clean.
          </div>
        </div>
      ) : (
        <div className="flex-1 space-y-6 overflow-y-auto p-3">
          {activeStates.map((state) => {
            const entries = grouped[state];

            return (
              <section
                key={state}
                className="content-visibility-auto contain-intrinsic-size-[auto_400px] space-y-3"
              >
                <div className="flex items-center gap-3">
                  <h3 className="text-[10px] font-black tracking-[0.3em] text-text-muted/20 uppercase">
                    {state}
                  </h3>
                  <div className="h-px flex-1 bg-border/10" />
                  <span className="text-[9px] font-bold tracking-tight text-text-muted/45 uppercase tabular-nums">
                    {entries.length} UNIT(S)
                  </span>
                </div>

                <div className="space-y-2">
                  {entries.map((file) => {
                    const hunks = parseDiff(file.diff);
                    return (
                      <DiffBlock
                        key={`${state}:${file.path}`}
                        path={file.path}
                        hunks={hunks}
                        onStage={
                          onStage && (file.state === 'modified' || file.state === 'untracked')
                            ? () => {
                                onStage(file.path);
                              }
                            : undefined
                        }
                        onRevert={
                          onRevert && (file.state === 'modified' || file.state === 'deleted')
                            ? () => {
                                onRevert(file.path);
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
      )}
    </div>
  );
}
