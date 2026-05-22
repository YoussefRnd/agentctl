import { Menu } from 'lucide-react';

interface SessionHeaderProps {
  sessionId: string;
  onOpenMobileSidebar: () => void;
}

export function SessionHeader({
  sessionId,
  onOpenMobileSidebar,
}: SessionHeaderProps) {

  return (
    <header className="border-border/50 flex shrink-0 h-14 items-center justify-between border-b px-6 bg-surface-secondary/10 backdrop-blur-md">
      <div className="flex min-w-0 items-center gap-4 max-w-[1200px] w-full pl-4 lg:pl-10">
        <button
          type="button"
          className="text-text-muted hover:text-accent -ml-1 p-1 transition-all lg:hidden hover:bg-accent/10 rounded"
          onClick={onOpenMobileSidebar}
          aria-label="Open Sidebar"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-3">
          <span className="text-text-muted font-display font-black text-[10px] tracking-[0.1em] opacity-40">
            SESSION::{sessionId.slice(0, 8)}
          </span>
          <div className="h-3 w-px bg-border/40 mx-1" />
          <span className="border-accent/30 text-accent flex items-center gap-2 px-2 py-0.5 text-[9px] font-display font-black tracking-widest uppercase border rounded-full bg-accent/5">
            <span className="bg-success h-1 w-1 animate-pulse rounded-full shadow-[0_0_8px_rgba(166,227,161,0.5)]" />
            LIVE_FEED
          </span>
        </div>
      </div>
    </header>
  );
}


