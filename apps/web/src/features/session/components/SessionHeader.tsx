import { Menu, PanelRight } from 'lucide-react';
import { Button } from '@agentctl/ui';

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
    <header className="border-border flex shrink-0 flex-col border-b px-6 py-2 sm:h-12 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-4">
        <button
          type="button"
          className="text-text-muted hover:text-text-main hover:bg-surface -ml-2 rounded-md p-1.5 transition-colors lg:hidden"
          onClick={onOpenMobileSidebar}
          aria-label="Open Sidebar"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2 text-[13px]">
          <span className="text-text-muted font-mono">{sessionId.slice(0, 8)}</span>
          <span className="bg-success/10 text-success flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10px] font-bold tracking-wider">
            <span className="bg-success h-1.5 w-1.5 animate-pulse rounded-full" />
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
          <PanelRight className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
