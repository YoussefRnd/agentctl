import { Link, useLocation } from 'react-router-dom';
import { Sparkles, ShieldCheck } from 'lucide-react';

export function SettingsSidebar() {
  const location = useLocation();

  return (
    <aside
      aria-label="Settings Sidebar"
      className="flex h-full w-full flex-col overflow-hidden bg-transparent"
    >
      <div className="flex-1 space-y-4 overflow-y-auto px-1 py-4">
        <div className="space-y-0.5">
          <div className="mb-1.5 px-2">
            <h3 className="text-text-muted text-[9px] font-bold tracking-widest uppercase opacity-50">
              System Settings
            </h3>
          </div>
          <Link
            to="/settings"
            className={`flex items-center gap-2 rounded-sm px-2 py-1.5 text-[11px] font-bold uppercase transition-all ${
              location.pathname === '/settings'
                ? 'bg-surface-tertiary text-accent shadow-[0_0_10px_rgba(203,166,247,0.1)]'
                : 'text-text-muted hover:text-accent hover:bg-surface-secondary'
            }`}
          >
            <Sparkles
              className={`h-3.5 w-3.5 ${location.pathname === '/settings' ? 'text-accent' : ''}`}
            />
            Providers
          </Link>
          <div className="text-text-muted/30 flex cursor-not-allowed items-center gap-2 rounded-sm px-2 py-1.5 text-[11px] font-bold uppercase grayscale">
            <ShieldCheck className="h-3.5 w-3.5" />
            Security
          </div>
        </div>
      </div>
      <div className="border-border/50 text-text-muted/30 relative z-10 border-t p-2 text-center text-[9px] font-bold tracking-tighter uppercase">
        AgentCTL v1.0.0
      </div>
    </aside>
  );
}
