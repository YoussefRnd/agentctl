import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { RotateCcw, GitBranch, Undo2 } from 'lucide-react';

export type RewindMode = 'conversation' | 'files' | 'fork';

interface RewindMenuProps {
  eventId: number;
  hasGitRepo: boolean;
  isSessionRunning: boolean;
  onRewind: (eventId: number, mode: RewindMode) => void;
  onClose: () => void;
}

interface MenuOption {
  mode: RewindMode;
  label: string;
  icon: typeof RotateCcw;
  description: string;
  disabled: boolean;
}

export function RewindMenu({
  eventId,
  hasGitRepo,
  isSessionRunning,
  onRewind,
  onClose,
}: RewindMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const options = useMemo<MenuOption[]>(
    () => [
      {
        mode: 'conversation',
        label: 'Rewind Conversation',
        icon: RotateCcw,
        description: 'Remove messages after this point. Files unchanged.',
        disabled: isSessionRunning,
      },
      {
        mode: 'files',
        label: 'Rewind + Files',
        icon: Undo2,
        description: 'Remove messages and restore files to this point.',
        disabled: isSessionRunning || !hasGitRepo,
      },
      {
        mode: 'fork',
        label: 'Fork From Here',
        icon: GitBranch,
        description: 'Create a new session from this point. Original unchanged.',
        disabled: isSessionRunning,
      },
    ],
    [isSessionRunning, hasGitRepo],
  );

  const enabledIndices = useMemo(
    () =>
      options.reduce<number[]>((acc, o, i) => {
        if (!o.disabled) acc.push(i);
        return acc;
      }, []),
    [options],
  );

  const [focusedIndex, setFocusedIndex] = useState(() => enabledIndices[0] ?? 0);
  const [prevEnabledIndices, setPrevEnabledIndices] = useState(enabledIndices);

  if (enabledIndices !== prevEnabledIndices) {
    setPrevEnabledIndices(enabledIndices);
    setFocusedIndex(enabledIndices[0] ?? 0);
  }

  const onRewindRef = useRef(onRewind);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onRewindRef.current = onRewind;
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        const currentPos = enabledIndices.indexOf(focusedIndex);
        const nextPos = Math.max(0, Math.min(enabledIndices.length - 1, currentPos + dir));
        setFocusedIndex(enabledIndices[nextPos] ?? focusedIndex);
      }

      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const option = options[focusedIndex];
        if (!option.disabled) {
          onRewindRef.current(eventId, option.mode);
          onCloseRef.current();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [focusedIndex, enabledIndices, options, eventId]);

  const handleItemClick = useCallback(
    (mode: RewindMode) => {
      onRewind(eventId, mode);
      onClose();
    },
    [eventId, onRewind, onClose],
  );

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-orientation="vertical"
      aria-label="Rewind options"
      className="w-full"
    >
      <div className="space-y-0.5 p-1.5">
        {options.map((opt, index) => {
          const ItemIcon = opt.icon;
          const isFocused = index === focusedIndex;

          return (
            <button
              key={opt.mode}
              type="button"
              role="menuitem"
              tabIndex={isFocused ? 0 : -1}
              disabled={opt.disabled}
              aria-disabled={opt.disabled}
              className={`flex w-full items-start gap-2.5 rounded-md border p-2 text-left transition-all ${
                opt.disabled
                  ? 'cursor-not-allowed border-transparent opacity-35'
                  : isFocused
                    ? 'border-border/40 bg-surface-secondary/30 cursor-pointer'
                    : 'border-border/10 bg-surface-secondary/[0.02] hover:border-border/30 hover:bg-surface-secondary/20 cursor-pointer'
              }`}
              onClick={() => {
                if (!opt.disabled) handleItemClick(opt.mode);
              }}
              onMouseEnter={() => {
                setFocusedIndex(index);
              }}
              title={
                opt.disabled && !hasGitRepo && opt.mode === 'files'
                  ? 'Requires a git repository'
                  : undefined
              }
            >
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded bg-white/5 ring-1 ring-white/5">
                <ItemIcon className="text-text-muted h-3 w-3" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="text-text-main truncate text-[12px] leading-snug font-medium">
                  {opt.label}
                </div>
                <div className="text-text-muted truncate text-[10px] leading-tight">
                  {opt.description}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
