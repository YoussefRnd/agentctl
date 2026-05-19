import { Menu, PanelRight } from 'lucide-react';
import { Button } from '../../../components/ui/Button';

interface SessionHeaderProps {
  sessionId: string;
  onOpenMobileSidebar: () => void;
  isWorkbenchOpen: boolean;
  onToggleWorkbench: () => void;
}

export function SessionHeader({
  sessionId,
  onOpenMobileSidebar,
  isWorkbenchOpen,
  onToggleWorkbench,
}: SessionHeaderProps) {
  return (
    <header className="border-b border-border flex flex-col px-6 py-2 shrink-0 sm:h-12 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4 min-w-0">
        <button
          type="button"
          className="lg:hidden p-1.5 -ml-2 text-text-muted hover:text-text-main hover:bg-surface rounded-md transition-colors"
          onClick={onOpenMobileSidebar}
          aria-label="Open Sidebar"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2 text-[13px]">
          <span className="font-mono text-text-muted">{sessionId.slice(0, 8)}</span>
          <span className="flex items-center gap-1.5 px-2 py-0.5 bg-success/10 text-success text-[10px] font-bold rounded-md tracking-wider">
            <span className="w-1.5 h-1.5 bg-success rounded-full animate-pulse" />
            LIVE
          </span>
        </div>
      </div>

      <div className="flex items-center">
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleWorkbench}
          className={`p-1.5 ${isWorkbenchOpen ? 'bg-accent/10 text-accent' : ''}`}
          title="Toggle Workbench (Cmd/Ctrl + \\)"
          aria-label="Toggle Workbench"
        >
          <PanelRight className="w-4 h-4" />
        </Button>
      </div>
    </header>
  );
}
