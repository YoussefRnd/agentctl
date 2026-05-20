import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft, Sparkles, ShieldCheck } from 'lucide-react';

export function SettingsSidebar() {
  const location = useLocation();

  return (
    <aside
      aria-label="Settings Sidebar"
      className="liquid-glass border-border relative z-20 flex h-full w-[260px] shrink-0 flex-col overflow-hidden border-r shadow-[4px_0_24px_rgba(0,0,0,0.5)]"
    >
      <div className="from-glass-highlight/20 pointer-events-none absolute inset-0 bg-gradient-to-b to-transparent" />
      <div className="border-border/50 bg-background/20 relative z-10 border-b p-4 backdrop-blur-md">
        <Link
          to="/"
          className="text-text-muted hover:text-text-main bg-surface-secondary/50 hover:bg-surface-hover/80 group flex items-center gap-2 rounded-xl border border-white/5 px-3 py-2 text-[11px] font-bold transition-all hover:border-white/10"
        >
          <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
          Back to Projects
        </Link>
      </div>
      <div className="flex-1 space-y-6 overflow-y-auto px-2 py-6">
        <div className="space-y-1">
          <div className="mb-2 px-3">
            <h3 className="text-text-muted text-[10px] font-bold tracking-[0.2em] uppercase opacity-50">
              System Settings
            </h3>
          </div>
          <Link
            to="/settings"
            className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] transition-all ${
              location.pathname === '/settings'
                ? 'bg-accent/15 text-accent border-accent/20 border font-semibold shadow-[0_0_15px_var(--color-accent-glow)]'
                : 'text-text-muted hover:text-text-main hover:bg-surface-hover/50'
            }`}
          >
            <Sparkles
              className={`h-4 w-4 ${location.pathname === '/settings' ? 'text-accent' : ''}`}
            />
            Providers
          </Link>
          <div className="text-text-muted/40 flex cursor-not-allowed items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] grayscale">
            <ShieldCheck className="h-4 w-4" />
            Security (Coming Soon)
          </div>
        </div>
      </div>
      <div className="border-border/50 bg-background/30 text-text-muted/50 relative z-10 border-t p-4 text-center text-[10px]">
        AgentCTL v1.0.0
      </div>
    </aside>
  );
}
