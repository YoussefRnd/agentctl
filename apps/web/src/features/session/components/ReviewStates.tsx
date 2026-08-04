import { Search, AlertCircle, Ban, CheckCircle2 } from 'lucide-react';
import { ReviewCleanState } from '../components/ReviewCleanState';

export function ReviewEmptyState({ searchQuery }: { searchQuery: string }) {
  if (searchQuery) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-6 text-center opacity-20">
        <Search className="mb-3 h-8 w-8" />
        <p className="text-[10px] font-black tracking-[0.15em] uppercase">
          No matching changes found
        </p>
      </div>
    );
  }
  return <ReviewCleanState />;
}

export function ReviewErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="bg-surface-secondary/5 flex-1 p-5">
      <div className="border-danger/20 bg-danger/5 relative overflow-hidden rounded-xl border p-4 shadow-2xl">
        <div className="absolute top-0 right-0 p-4 opacity-5">
          <AlertCircle className="text-danger h-24 w-24" />
        </div>
        <div className="text-danger mb-4 flex items-center gap-3 text-[11px] font-black tracking-[0.2em] uppercase">
          <AlertCircle className="h-5 w-5" />
          Critical Workspace Error
        </div>
        <div className="text-danger/70 selection:bg-danger/20 font-mono text-[11px] leading-relaxed">
          {error.message}
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="bg-danger mt-6 flex h-8 cursor-pointer items-center rounded-lg px-5 text-[10px] font-black tracking-widest text-white uppercase transition-all hover:opacity-90"
          >
            Retry Scan
          </button>
        )}
      </div>
    </div>
  );
}

export function ReviewLoadingState() {
  return (
    <div className="text-text-muted/40 bg-surface-secondary/5 flex h-full flex-col items-center justify-center p-8">
      <div className="relative mb-6">
        <div className="border-accent/20 border-t-accent h-8 w-8 animate-spin rounded-full border-2" />
        <div className="bg-accent/20 absolute inset-0 animate-pulse rounded-full blur-lg" />
      </div>
      <span className="text-[10px] font-black tracking-[0.3em] uppercase">
        Scanning Workspace...
      </span>
    </div>
  );
}

export function ReviewClosedState({ sessionStatus }: { sessionStatus?: string }) {
  return (
    <div className="bg-surface-secondary/5 flex h-full flex-col items-center justify-center p-6 text-center">
      <div className="bg-surface-secondary/20 border-border/10 ring-surface-secondary/5 mb-4 flex items-center justify-center rounded-xl border p-4 shadow-2xl ring-1">
        {sessionStatus === 'merged' ? (
          <CheckCircle2 className="text-brand-teal h-10 w-10 drop-shadow-[0_0_10px_rgba(45,226,176,0.3)]" />
        ) : (
          <Ban className="text-text-muted/60 h-10 w-10" />
        )}
      </div>
      <h3 className="text-text-main mb-2 text-[14px] font-black tracking-[0.4em] uppercase">
        Session {sessionStatus}
      </h3>
      <p className="text-text-muted/40 max-w-[260px] text-[10px] leading-relaxed font-bold tracking-widest uppercase">
        This workspace has been finalized. All changes were{' '}
        {sessionStatus === 'merged'
          ? 'successfully applied to the project'
          : 'permanently discarded'}
        .
      </p>
    </div>
  );
}
