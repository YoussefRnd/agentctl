import { Settings, Keyboard } from 'lucide-react';
import { useSettingsOverlayStore } from '@/features/settings';
import { useShellStore } from './model/useShellStore';
import { formatShortcut } from '@/shared/lib/platform';

export function SidebarFooter() {
  const openSettings = useSettingsOverlayStore((s) => s.openSettings);
  const openShortcuts = useShellStore((s) => s.openShortcuts);

  return (
    <div className="border-border/30 bg-surface/30 relative z-10 mt-auto flex items-center gap-1 border-t p-1.5">
      <button
        type="button"
        onClick={() => openSettings('general')}
        className="text-text-muted hover:text-text-main hover:bg-surface-secondary/80 focus-visible:ring-accent/40 click-press group flex flex-1 cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 text-xs font-medium transition-[color,background-color,transform] duration-150 focus-visible:ring-2 focus-visible:outline-none"
      >
        <div className="flex items-center gap-2">
          <Settings className="text-text-muted group-hover:text-accent h-3.5 w-3.5 transition-colors" />
          <span>Settings</span>
        </div>
        <kbd className="bg-surface-secondary/80 border-border/30 text-text-muted/60 rounded px-1.5 py-0.5 font-mono text-[9px]">
          {formatShortcut(',')}
        </kbd>
      </button>

      <button
        type="button"
        onClick={() => openShortcuts()}
        className="text-text-muted hover:text-text-main hover:bg-surface-secondary/80 focus-visible:ring-accent/40 click-press group flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-[color,background-color,transform] duration-150 focus-visible:ring-2 focus-visible:outline-none"
        title={`Keyboard Shortcuts (${formatShortcut('/')})`}
        aria-label="Keyboard Shortcuts"
      >
        <Keyboard className="text-text-muted group-hover:text-accent h-3.5 w-3.5 transition-colors" />
      </button>
    </div>
  );
}
