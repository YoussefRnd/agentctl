import { Menu, PanelRight } from 'lucide-react';

interface SessionHeaderProps {
  onOpenMobileSidebar: () => void;
  onToggleWorkbench: () => void;
  isWorkbenchOpen: boolean;
}

export function SessionHeader({
  onOpenMobileSidebar,
  onToggleWorkbench,
  isWorkbenchOpen,
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
      </div>

      {/* Workbench toggle — always visible in navbar */}
      <button
        type="button"
        onClick={onToggleWorkbench}
        aria-label="Toggle Inspector"
        title="Toggle Inspector (⌘\\)"
        className={`flex h-8 w-8 items-center justify-center rounded-xl border transition-all duration-300 ${
          isWorkbenchOpen
            ? 'border-accent/30 bg-accent/10 text-accent font-bold'
            : 'border-border/20 bg-surface/30 text-text-muted hover:text-text-main hover:border-border/40 hover:bg-surface/60'
        }`}
      >
        <PanelRight className="h-4 w-4" />
      </button>
    </div>
  );
}
