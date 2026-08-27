import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useUIStore, type SettingsTab } from '../../../shared';
import { GeneralSettingsView } from './GeneralSettingsView';
import { ProvidersSettingsView } from './ProvidersSettingsView';
import { McpSettings } from './McpSettings';
import { SlidersHorizontal, Sparkles, Cpu, X } from 'lucide-react';

const TABS: { id: SettingsTab; label: string; icon: typeof SlidersHorizontal }[] = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'providers', label: 'AI Providers', icon: Sparkles },
  { id: 'mcp', label: 'MCP Servers', icon: Cpu },
];

export function SettingsDialog() {
  const isSettingsOpen = useUIStore((s) => s.isSettingsOpen);
  const closeSettings = useUIStore((s) => s.closeSettings);
  const settingsTab = useUIStore((s) => s.settingsTab);
  const setSettingsTab = useUIStore((s) => s.setSettingsTab);

  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isSettingsOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSettings();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSettingsOpen, closeSettings]);

  if (!isSettingsOpen) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-dialog-title"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-md transition-opacity duration-200"
        onClick={closeSettings}
        aria-hidden="true"
      />

      {/* Modal Dialog Window */}
      <div
        ref={modalRef}
        className="text-text-main border-border/30 bg-brand-mantle relative flex h-[620px] max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border shadow-2xl transition-all duration-200 md:flex-row"
      >
        {/* Left Sub-Nav Sidebar */}
        <div className="border-border/30 bg-surface/20 flex w-full shrink-0 flex-col justify-between border-b p-3 md:w-56 md:border-r md:border-b-0 md:p-4">
          <div className="space-y-3">
            <div className="px-2 pt-1">
              <h2
                id="settings-dialog-title"
                className="text-text-main text-sm font-bold tracking-tight"
              >
                Settings
              </h2>
              <p className="text-text-muted mt-0.5 text-[11px]">Preferences & Integrations</p>
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
                    className={`flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all ${
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
          <button
            type="button"
            onClick={closeSettings}
            aria-label="Close settings"
            className="text-text-muted hover:text-text-main hover:bg-surface/60 absolute top-3.5 right-3.5 z-20 flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg transition-colors"
          >
            <X className="h-4 w-4" />
          </button>

          {/* Scrollable Content Body */}
          <div className="flex-1 overflow-y-auto p-6">
            {settingsTab === 'general' && <GeneralSettingsView />}
            {settingsTab === 'providers' && <ProvidersSettingsView />}
            {settingsTab === 'mcp' && <McpSettings />}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
