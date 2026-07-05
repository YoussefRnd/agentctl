import { Link, useLocation } from 'react-router-dom';
import { Sparkles, ShieldCheck, SlidersHorizontal, Cpu } from 'lucide-react';

export function SettingsSidebar() {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const activeTab = searchParams.get('tab') ?? 'providers';

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
            className={`flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] font-bold uppercase transition-all ${
              activeTab === 'providers'
                ? 'bg-surface-accent text-accent border-border-active border'
                : 'text-text-muted hover:text-accent hover:bg-surface-secondary/50 border border-transparent'
            }`}
          >
            <Sparkles className={`h-3.5 w-3.5 ${activeTab === 'providers' ? 'text-accent' : ''}`} />
            Providers
          </Link>
          <Link
            to="/settings?tab=mcp"
            className={`flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] font-bold uppercase transition-all ${
              activeTab === 'mcp'
                ? 'bg-surface-accent text-accent border-border-active border'
                : 'text-text-muted hover:text-accent hover:bg-surface-secondary/50 border border-transparent'
            }`}
          >
            <Cpu className={`h-3.5 w-3.5 ${activeTab === 'mcp' ? 'text-accent' : ''}`} />
            MCP Servers
          </Link>
          <Link
            to="/settings?tab=general"
            className={`flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] font-bold uppercase transition-all ${
              activeTab === 'general'
                ? 'bg-surface-accent text-accent border-border-active border'
                : 'text-text-muted hover:text-accent hover:bg-surface-secondary/50 border border-transparent'
            }`}
          >
            <SlidersHorizontal
              className={`h-3.5 w-3.5 ${activeTab === 'general' ? 'text-accent' : ''}`}
            />
            General
          </Link>

          <div className="text-text-muted/30 flex cursor-not-allowed items-center gap-2 rounded-xl border border-transparent px-3 py-2 text-[11px] font-bold uppercase grayscale">
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
