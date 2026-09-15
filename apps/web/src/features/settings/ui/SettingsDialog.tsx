import { AgentIcon } from '@/shared';
import { useSettingsOverlayStore, type SettingsTab } from '../model/useSettingsOverlayStore';
import { GeneralSettingsView } from './GeneralSettingsView';
import { ProvidersSettingsView } from './ProvidersSettingsView';
import { McpSettings } from './McpSettings';
import { SlidersHorizontal, Cpu, X } from 'lucide-react';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@agentctl/ui';

const TABS: {
  id: SettingsTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'providers', label: 'AI Providers', icon: AgentIcon },
  { id: 'mcp', label: 'MCP Servers', icon: Cpu },
];

export function SettingsDialog() {
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
        className="text-text-main border-border/30 bg-brand-mantle h-[620px] max-h-[90vh] max-w-4xl gap-0 overflow-hidden rounded-2xl border p-0 sm:max-w-4xl md:flex md:flex-row"
      >
        {/* Left Sub-Nav Sidebar */}
        <div className="border-border/30 bg-surface/20 flex w-full shrink-0 flex-col justify-between border-b p-3 md:w-56 md:border-r md:border-b-0 md:p-4">
          <div className="space-y-3">
            <div className="px-2 pt-1">
              <DialogTitle className="text-sm font-bold tracking-tight">Settings</DialogTitle>
              <DialogDescription className="mt-0.5 text-[11px] opacity-100">
                Preferences & Integrations
              </DialogDescription>
            </div>

            {/* Nav Tabs */}
            <div className="flex gap-1 overflow-x-auto md:flex-col md:space-y-1 md:overflow-visible">
              {TABS.map(({ id, label, icon: Icon }) => {
                const isActive = settingsTab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSettingsTab(id)}
                    className={`flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
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
              <span className="font-mono">AgentCTL v1.0.0</span>
              <kbd className="bg-surface/60 rounded px-1.5 py-0.5 font-mono text-[9px]">Esc</kbd>
            </div>
          </div>
        </div>

        {/* Right Content Area */}
        <div className="bg-background relative flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Top Close Button */}
          <DialogClose
            aria-label="Close settings"
            className="text-text-muted hover:text-text-main hover:bg-surface/60 absolute top-3.5 right-3.5 z-20 flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg transition-colors"
          >
            <X className="h-4 w-4" />
          </DialogClose>

          {/* Scrollable Content Body */}
          <div className="flex-1 overflow-y-auto p-6">
            {settingsTab === 'general' && <GeneralSettingsView />}
            {settingsTab === 'providers' && <ProvidersSettingsView />}
            {settingsTab === 'mcp' && <McpSettings />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
