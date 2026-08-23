import { Link } from 'react-router-dom';
import { Settings } from 'lucide-react';

export function SidebarFooter() {
  return (
    <div className="border-border/30 bg-surface/30 relative z-10 mt-auto border-t p-2">
      <Link
        to="/settings"
        className="text-text-muted hover:text-text-main hover:bg-surface-secondary/80 group flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors"
      >
        <div className="flex items-center gap-2">
          <Settings className="text-text-muted group-hover:text-accent h-3.5 w-3.5 transition-colors" />
          <span>Settings</span>
        </div>
        <kbd className="bg-surface-secondary/80 border-border/30 text-text-muted/60 rounded px-1.5 py-0.5 font-mono text-[9px]">
          ⌘,
        </kbd>
      </Link>
    </div>
  );
}
