import { Search, Ban, CheckCircle2 } from 'lucide-react';
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
