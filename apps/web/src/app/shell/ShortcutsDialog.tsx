import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@agentctl/ui';
import { useShellStore } from './model/useShellStore';
import { formatShortcut } from '@/shared/lib/platform';
import { Keyboard, Command, MessageSquareCode, GitPullRequest } from 'lucide-react';

interface ShortcutGroup {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcuts: {
    label: string;
    keys: string[];
  }[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Global & Navigation',
    icon: Command,
    shortcuts: [
      { label: 'Command Palette', keys: [formatShortcut('K')] },
      { label: 'Toggle Sidebar', keys: [formatShortcut('B')] },
      { label: 'Toggle Inspector / Workbench', keys: [formatShortcut('\\')] },
      { label: 'Settings', keys: [formatShortcut(',')] },
      { label: 'Keyboard Shortcuts', keys: [formatShortcut('/'), 'or', '?'] },
    ],
  },
  {
    title: 'Composer & Chat Box',
    icon: MessageSquareCode,
    shortcuts: [
      { label: 'Send message', keys: ['Enter'] },
      { label: 'New line in composer', keys: ['Shift', '+', 'Enter'] },
      { label: 'Mention file or git context', keys: ['@'] },
      { label: 'Trigger slash command', keys: ['/'] },
      { label: 'Navigate suggestions', keys: ['↑', '↓'] },
      { label: 'Accept suggestion', keys: ['Tab', 'or', 'Enter'] },
      { label: 'Stop running agent', keys: ['Esc', 'Esc'] },
    ],
  },
  {
    title: 'Diff Review & Diffs',
    icon: GitPullRequest,
    shortcuts: [
      { label: 'Next changed file', keys: ['j', 'or', ']'] },
      { label: 'Previous changed file', keys: ['k', 'or', '['] },
      { label: 'Exit maximized view', keys: ['Esc'] },
    ],
  },
];

export function ShortcutsDialog() {
  const isShortcutsOpen = useShellStore((s) => s.isShortcutsOpen);
  const closeShortcuts = useShellStore((s) => s.closeShortcuts);

  return (
    <Dialog open={isShortcutsOpen} onOpenChange={(open) => !open && closeShortcuts()}>
      <DialogContent className="border-border/30 bg-surface/95 max-w-lg overflow-hidden p-0 shadow-2xl backdrop-blur-2xl">
        <DialogHeader className="border-border/20 border-b px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="bg-accent/15 text-accent flex h-8 w-8 items-center justify-center rounded-lg shadow-xs">
              <Keyboard className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle className="text-text-main text-sm font-semibold tracking-tight">
                Keyboard Shortcuts
              </DialogTitle>
              <DialogDescription className="text-text-muted/60 text-xs">
                Quick reference for power-user controls and chat box shortcuts.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="custom-scrollbar max-h-[60vh] space-y-5 overflow-y-auto px-5 py-4">
          {SHORTCUT_GROUPS.map((group) => {
            const Icon = group.icon;
            return (
              <div key={group.title} className="space-y-2">
                <div className="text-text-muted/60 flex items-center gap-2 text-[11px] font-semibold tracking-wider uppercase">
                  <Icon className="text-accent/70 h-3.5 w-3.5" />
                  <span>{group.title}</span>
                </div>

                <div className="border-border/25 bg-surface-secondary/25 divide-border/15 divide-y overflow-hidden rounded-xl border">
                  {group.shortcuts.map((shortcut) => (
                    <div
                      key={shortcut.label}
                      className="hover:bg-surface-secondary/40 flex items-center justify-between px-3.5 py-2 text-xs transition-colors select-none"
                    >
                      <span className="text-text-main/90 font-medium">{shortcut.label}</span>
                      <div className="flex items-center gap-1">
                        {shortcut.keys.map((k, i) =>
                          k === 'or' || k === '+' ? (
                            <span
                              key={`${k}-${i.toString()}`}
                              className="text-text-muted/50 px-0.5 text-[10px]"
                            >
                              {k}
                            </span>
                          ) : (
                            <kbd
                              key={`${k}-${i.toString()}`}
                              className="border-border/30 bg-surface/80 text-text-main inline-flex h-5.5 min-w-5.5 items-center justify-center rounded-md border px-1.5 font-mono text-[10px] font-semibold shadow-xs"
                            >
                              {k}
                            </kbd>
                          ),
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="border-border/15 bg-surface-secondary/20 text-text-muted/50 flex items-center justify-between border-t px-5 py-2.5 text-[11px]">
          <span>
            Toggle this sheet anytime with{' '}
            <kbd className="border-border/40 bg-surface text-text-muted rounded border px-1 py-0.5 font-mono text-[9px]">
              ?
            </kbd>
          </span>
          <kbd className="border-border/40 bg-surface text-text-muted rounded border px-1.5 py-0.5 font-mono text-[9px]">
            Esc to close
          </kbd>
        </div>
      </DialogContent>
    </Dialog>
  );
}
