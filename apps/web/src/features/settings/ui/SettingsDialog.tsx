import { AgentIcon, useAppVersion } from '@/shared';
import { useSettingsOverlayStore, type SettingsTab } from '../model/useSettingsOverlayStore';
import { GeneralSettingsView } from './GeneralSettingsView';
import { ProvidersSettingsView } from './ProvidersSettingsView';
import { McpSettings } from './McpSettings';
import { SlidersHorizontal, Server, X } from 'lucide-react';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@agentctl/ui';

const TABS: {
  id: SettingsTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'providers', label: 'AI Providers', icon: AgentIcon },
  { id: 'mcp', label: 'MCP Servers', icon: Server },
];

export function SettingsDialog() {
  const version = useAppVersion();
  const isSettingsOpen = useSettingsOverlayStore((s) => s.isSettingsOpen);
  const closeSettings = useSettingsOverlayStore((s) => s.closeSettings);
  const settingsTab = useSettingsOverlayStore((s) => s.settingsTab);
  const setSettingsTab = useSettingsOverlayStore((s) => s.setSettingsTab);

  return (
    <Dialog
      open={isSettingsOpen}
      onOpenChange={(open) => {
        if (!open) closeSettings();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="text-text-main border-border/30 bg-brand-mantle flex h-[620px] max-h-[90vh] max-w-4xl flex-col gap-0 overflow-hidden border p-0 sm:max-w-4xl md:flex md:flex-row"
      >
        {/* Left Sub-Nav Sidebar */}
        <div className="border-border/30 bg-surface/20 flex w-full shrink-0 flex-col justify-between border-b p-3 md:w-56 md:border-r md:border-b-0 md:p-4">
          <div className="space-y-3">
            <div className="px-2 pt-1">
              <div className="flex items-start justify-between gap-2">
                <DialogTitle className="text-sm font-bold tracking-tight">Settings</DialogTitle>
                <DialogClose
                  aria-label="Close settings"
                  className="text-text-muted hover:text-text-main hover:bg-surface/60 flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors"
                >
                  <X className="h-4 w-4" />
                </DialogClose>
              </div>
              <DialogDescription className="mt-0.5 text-[11px] opacity-100">
                Preferences & Integrations
              </DialogDescription>
            </div>

            {/* Nav Tabs */}
            <div
              className="-my-1 flex min-w-0 gap-1 overflow-x-auto py-1 md:my-0 md:flex-col md:space-y-1 md:overflow-visible md:py-0"
              role="tablist"
              aria-label="Settings sections"
            >
              {TABS.map(({ id, label, icon: Icon }) => {
                const isActive = settingsTab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    tabIndex={isActive ? 0 : -1}
                    onClick={() => setSettingsTab(id)}
                    className={`focus-visible:ring-accent/40 flex shrink-0 cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-xs font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none ${
                      isActive
                        ? 'bg-accent/15 text-accent border-accent/30 border shadow-sm'
                        : 'text-text-muted hover:text-text-main hover:bg-surface/50 border border-transparent'
                    }`}
                  >
                    <Icon className={`h-4 w-4 ${isActive ? 'text-accent' : 'text-text-muted'}`} />
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Footer inside sidebar */}
          <div className="border-border/20 hidden border-t pt-3 md:block">
            <div className="text-text-muted/60 flex items-center justify-between text-[10px]">
              <span className="font-mono">AgentCTL v{version}</span>
              <kbd className="bg-surface/60 rounded px-1.5 py-0.5 font-mono text-[9px]">Esc</kbd>
            </div>
          </div>
        </div>

        {/* Right Content Area */}
        <div className="bg-background relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {/* Scrollable Content Body */}
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
            {settingsTab === 'general' && <GeneralSettingsView />}
            {settingsTab === 'providers' && <ProvidersSettingsView />}
            {settingsTab === 'mcp' && <McpSettings />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
