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
    <header className="border-border flex shrink-0 h-11 items-center justify-between border-b px-3 bg-black">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          className="text-text-muted hover:text-white -ml-1 p-1 transition-colors lg:hidden"
          onClick={onOpenMobileSidebar}
          aria-label="Open Sidebar"
        >
          <Menu className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-text-muted font-bold opacity-30">SESSION::{sessionId.slice(0, 8)}</span>
          <span className="border border-white/20 text-white flex items-center gap-1.5 px-1.5 py-0.5 text-[9px] font-black tracking-widest uppercase">
            <span className="bg-white h-1 w-1 animate-pulse status-glow" />
            LIVE_FEED
          </span>
        </div>
      </div>
    </header>
  );
}


