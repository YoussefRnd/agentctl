import { Menu, PanelRight } from 'lucide-react';

interface SessionHeaderProps {
  sessionId: string;
  onOpenMobileSidebar: () => void;
  onToggleWorkbench: () => void;
  isWorkbenchOpen: boolean;
  sessionTitle?: string | null;
}

export function SessionHeader({
  sessionId,
  onOpenMobileSidebar,
  onToggleWorkbench,
  isWorkbenchOpen,
  sessionTitle,
}: SessionHeaderProps) {
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
        <div className="border-border/20 bg-surface/40 flex items-center gap-1.5 rounded-full border px-2.5 py-1">
          <span className="bg-accent/60 h-1.5 w-1.5 animate-pulse rounded-full" />
          <span className="text-text-muted max-w-[180px] truncate text-[10px] font-bold tracking-[0.15em] uppercase">
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
