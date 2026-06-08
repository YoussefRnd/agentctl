import { Menu, PanelRight } from 'lucide-react';

interface SessionHeaderProps {
  sessionId: string;
  onOpenMobileSidebar: () => void;
  onToggleWorkbench: () => void;
  isWorkbenchOpen: boolean;
  sessionTitle?: string | null;
  status?: string | null;
}

export function SessionHeader({
  sessionId,
  onOpenMobileSidebar,
  onToggleWorkbench,
  isWorkbenchOpen,
  sessionTitle,
  status,
}: SessionHeaderProps) {
  // Rich, curated statuses with distinct colored glows and animations
  const statusConfig = (() => {
    switch (status) {
      case 'running':
        return { color: 'bg-sky-400 shadow-[0_0_12px_#38bdf8]', animate: 'animate-pulse' };
      case 'needs_attention':
        return { color: 'bg-amber-400 shadow-[0_0_12px_#fbbf24]', animate: 'animate-bounce' };
      case 'error':
        return { color: 'bg-rose-500 shadow-[0_0_14px_#f43f5e]', animate: 'animate-ping' };
      case 'merged':
        return { color: 'bg-purple-500/60 shadow-[0_0_8px_rgba(168,85,247,0.4)]', animate: '' };
      case 'discarded':
        return { color: 'bg-zinc-600/40', animate: '' };
      case 'idle':
      default:
        return { color: 'bg-emerald-400 shadow-[0_0_10px_#34d399]', animate: '' };
    }
  })();

  return (
    <div className="flex h-full w-full min-w-0 items-center justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          className="text-text-muted hover:text-accent hover:bg-accent/10 -ml-1 rounded p-1 transition-all lg:hidden"
          onClick={onOpenMobileSidebar}
          aria-label="Open Sidebar"
        >
          <Menu className="h-5 w-5" />
        </button>
        {/* Session chip */}
        <div className="border-border/20 bg-surface/40 flex items-center gap-2 rounded-full border px-3.5 py-1">
          <div className="relative flex h-2 w-2">
            {statusConfig.animate && (
              <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${statusConfig.color} ${statusConfig.animate}`} />
            )}
            <span className={`relative inline-flex h-2 w-2 rounded-full ${statusConfig.color}`} />
          </div>
          <span className="text-text-muted max-w-[180px] truncate text-[10px] font-bold tracking-[0.15em] uppercase">
            {status === 'error' ? '[crashed] ' : ''}
            {sessionTitle ?? `session::${sessionId.slice(0, 8)}`}
          </span>
        </div>
      </div>

      {/* Workbench toggle — always visible in navbar */}
      <button
        type="button"
        onClick={onToggleWorkbench}
        aria-label="Toggle Inspector"
        title="Toggle Inspector (⌘\\)"
        className={`flex h-8 w-8 items-center justify-center rounded-md border transition-all duration-300 ${
          isWorkbenchOpen
            ? 'border-accent/30 bg-accent/10 text-accent'
            : 'border-border/20 bg-surface/30 text-text-muted hover:text-text-main hover:border-border/40 hover:bg-surface/60'
        }`}
      >
        <PanelRight className="h-4 w-4" />
      </button>
    </div>
  );
}
