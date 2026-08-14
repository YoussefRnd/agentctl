import { Link } from 'react-router-dom';
import { Settings } from 'lucide-react';

export function SidebarFooter() {
  return (
    <div className="border-border/40 relative z-10 mt-auto border-t p-2">
      <Link
        to="/settings"
        className="text-text-muted hover:text-brand-mauve hover:bg-surface-secondary group flex w-full items-center gap-2 rounded-lg p-2 text-[11px] font-medium transition-all"
      >
        <Settings className="h-4 w-4" />
        <span>Settings</span>
      </Link>
    </div>
  );
}
