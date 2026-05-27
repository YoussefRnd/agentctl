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
}: {
 files: ReviewFile[];
 isLoading: boolean;
 error?: Error | null;
 onRetry?: () => void;
 onStage?: (filePath: string) => void;
 onRevert?: (filePath: string) => void;
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
  return <div className="text-text-muted p-2 text-[10px] font-bold uppercase animate-pulse">Scanning changes...</div>;
 }

 if (error) {
  return (
   <div className="flex-1 p-2">
    <div className="border-white/20 bg-white/5 rounded-sm border p-2 text-[11px]">
     <div className="text-white font-bold uppercase">Critical Error</div>
     <div className="text-text-muted mt-1 uppercase tracking-tighter">{error.message}</div>
     {onRetry && (
      <button
       type="button"
       onClick={onRetry}
       className="terminal-button mt-4"
      >
       RETRY_SCAN
      </button>
     )}
    </div>
   </div>
  );
 }

 if (files.length === 0) {
  return <div className="text-text-muted p-2 text-[10px] font-bold uppercase opacity-30">Worktree clean.</div>;
 }

 const activeStates = (Object.keys(grouped) as FileState[]).filter(
  (state) => grouped[state].length > 0,
 );

 return (
  <div className="flex h-full min-h-0 flex-col">
   <div className="border-border shrink-0 border-b p-2">
    <h2 className="text-white text-[12px] font-black tracking-[0.2em] uppercase mb-3">CODE_REVIEW_MANIFEST</h2>
    <div className="flex flex-wrap gap-x-6 gap-y-2">
     {activeStates.map((state) => (
      <div key={state} className="flex items-baseline gap-2">
       <span className="text-white/30 text-[9px] font-black tracking-widest uppercase">
        {state}
       </span>
       <span className="text-white text-[16px] font-black tabular-nums">
        {grouped[state].length}
       </span>
      </div>
     ))}
    </div>
   </div>
   <div className="flex-1 space-y-6 overflow-y-auto p-2">
    {activeStates.map((state) => {
     const entries = grouped[state];

     return (
      <section key={state} className="space-y-3 content-visibility-auto contain-intrinsic-size-[auto_400px]">
       <div className="flex items-center gap-3">
        <h3 className="text-white/20 text-[10px] font-black tracking-[0.3em] uppercase">
         {state}
        </h3>
        <div className="bg-white/5 h-px flex-1" />
        <span className="text-white/40 text-[9px] font-bold uppercase tracking-tight tabular-nums">
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
             ? () => { onStage(file.path); }
             : undefined
           }
           onRevert={
            onRevert && (file.state === 'modified' || file.state === 'deleted')
             ? () => { onRevert(file.path); }
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

