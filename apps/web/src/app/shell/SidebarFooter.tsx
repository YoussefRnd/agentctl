import { Button, IconButton, Kbd } from '@agentctl/ui';
import { Settings, Keyboard } from 'lucide-react';
import { useSettingsOverlayStore } from '@/features/settings';
import { useShellStore } from './model/useShellStore';
import { formatShortcut } from '@/shared/lib/platform';

export function SidebarFooter() {
  const openSettings = useSettingsOverlayStore((s) => s.openSettings);
  const openShortcuts = useShellStore((s) => s.openShortcuts);

  return (
    <div className="border-border/30 relative z-10 mt-auto flex items-center gap-2 border-t px-3 py-2">
      <Button
        type="button"
        variant="ghost"
        size="default"
        onClick={() => openSettings('general')}
        className="motion-disclosure min-w-0 flex-1 justify-between px-2 active:transform-none active:opacity-100"
      >
        <div className="flex items-center gap-2">
          <Settings className="icon-compact text-text-muted" />
          <span>Settings</span>
        </div>
        <Kbd>{formatShortcut(',')}</Kbd>
      </Button>

      <IconButton
        type="button"
        size="default"
        onClick={() => openShortcuts()}
        className="motion-disclosure shrink-0 active:transform-none active:opacity-100"
        title={`Keyboard shortcuts (${formatShortcut('/')})`}
        aria-label="Keyboard shortcuts"
      >
        <Keyboard className="icon-compact text-text-muted" />
      </IconButton>
    </div>
  );
}
