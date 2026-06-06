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
        <div className="rounded-full bg-white/5 p-4 mb-4 border border-white/10">
          <span className="text-[24px]">
            {sessionStatus === 'merged' ? '✅' : '🗑️'}
          </span>
        </div>
        <h3 className="text-[12px] font-black tracking-widest text-white uppercase mb-1">
          SESSION_{sessionStatus?.toUpperCase()}
        </h3>
        <p className="text-[10px] text-text-muted max-w-[240px] leading-relaxed uppercase">
          This session has been finalized. All changes have been {sessionStatus === 'merged' ? 'merged into the main branch' : 'discarded'}.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="text-text-muted animate-pulse p-2 text-[10px] font-bold uppercase">
        Scanning changes...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 p-2">
        <div className="rounded-sm border border-white/20 bg-white/5 p-2 text-[11px]">
          <div className="font-bold text-white uppercase">Critical Error</div>
          <div className="text-text-muted mt-1 tracking-tighter uppercase">{error.message}</div>
          {onRetry && (
            <button type="button" onClick={onRetry} className="terminal-button mt-4">
              RETRY_SCAN
            </button>
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
      <div className="border-border shrink-0 border-b p-2">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[12px] font-black tracking-[0.2em] text-white uppercase">
            CODE_REVIEW_MANIFEST
          </h2>
          {sessionStatus && !isClosed && (
            <div className="flex gap-1">
              <button
                type="button"
                disabled={isMerging || isDiscarding}
                onClick={() => {
                  const msg = window.prompt('Enter commit message (optional):', taskSlug || '');
                  if (msg !== null && onMerge) {
                    onMerge(msg);
                  }
                }}
                className="px-2 py-1 bg-green-600 hover:bg-green-700 disabled:bg-white/5 disabled:text-white/20 text-[9px] font-black tracking-wider text-white uppercase rounded transition-colors"
              >
                {isMerging ? 'MERGING...' : 'MERGE'}
              </button>
              <button
                type="button"
                disabled={isMerging || isDiscarding}
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
                className="px-2 py-1 bg-red-600 hover:bg-red-700 disabled:bg-white/5 disabled:text-white/20 text-[9px] font-black tracking-wider text-white uppercase rounded transition-colors"
              >
                {isDiscarding ? 'DISCARDING...' : 'DISCARD'}
              </button>
            </div>
          )}
        </div>
        {files.length > 0 && (
          <div className="flex flex-wrap gap-x-6 gap-y-2 col">
            {activeStates.map((state) => (
              <div key={state} className="flex items-baseline gap-2">
                <span className="text-[9px] font-black tracking-widest text-white/30 uppercase">
                  {state}
                </span>
                <span className="text-[16px] font-black text-white tabular-nums">
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
        <div className="flex-1 space-y-6 overflow-y-auto p-2">
          {activeStates.map((state) => {
            const entries = grouped[state];

            return (
              <section
                key={state}
                className="content-visibility-auto contain-intrinsic-size-[auto_400px] space-y-3"
              >
                <div className="flex items-center gap-3">
                  <h3 className="text-[10px] font-black tracking-[0.3em] text-white/20 uppercase">
                    {state}
                  </h3>
                  <div className="h-px flex-1 bg-white/5" />
                  <span className="text-[9px] font-bold tracking-tight text-white/40 uppercase tabular-nums">
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
