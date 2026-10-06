import React, { useEffect, useRef } from 'react';
import { Folder, Code2, Loader2, CornerDownLeft } from 'lucide-react';
import { cn, PopoverContent } from '@agentctl/ui';
import { DiffIcon, GitBranchIcon, GitCommitIcon } from '@primer/octicons-react';
import type { ContextItem, ContextItemType } from '@agentctl/api-client';
import { FileIcon } from '@/shared';

interface ContextDropdownProps {
  isOpen: boolean;
  items: ContextItem[];
  isLoading: boolean;
  activeIndex: number;
  onSelectItem: (item: ContextItem) => void;
  filterType: 'all' | ContextItemType;
  setFilterType: (type: 'all' | ContextItemType) => void;
}

function renderDropdownIcon(item: ContextItem) {
  if (item.type === 'file') {
    return <FileIcon path={item.title} className="h-3.5 w-3.5 shrink-0" />;
  }
  if (item.type === 'folder') {
    return <Folder className="h-3.5 w-3.5 shrink-0 text-amber-400/90" />;
  }
  if (item.type === 'git') {
    if (item.id === 'git:diff')
      return <DiffIcon className="h-3.5 w-3.5 shrink-0 text-purple-400" />;
    if (item.id === 'git:staged')
      return <GitBranchIcon className="h-3.5 w-3.5 shrink-0 text-emerald-400" />;
    if (item.id === 'git:log')
      return <GitCommitIcon className="h-3.5 w-3.5 shrink-0 text-blue-400" />;
    return <GitBranchIcon className="h-3.5 w-3.5 shrink-0 text-purple-400" />;
  }
  return <Code2 className="text-accent h-3.5 w-3.5 shrink-0" />;
}

export function ContextDropdown({
  isOpen,
  items,
  isLoading,
  activeIndex,
  onSelectItem,
  filterType,
  setFilterType,
}: ContextDropdownProps) {
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (isOpen && itemRefs.current[activeIndex]) {
      itemRefs.current[activeIndex]?.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      });
    }
  }, [isOpen, activeIndex]);

  if (!isOpen) return null;

  return (
    <PopoverContent
      role="region"
      aria-label="Context suggestions"
      side="top"
      align="start"
      sideOffset={10}
      onOpenAutoFocus={(event) => event.preventDefault()}
      onCloseAutoFocus={(event) => event.preventDefault()}
      className="border-border/30 bg-brand-mantle/95 flex max-h-[min(20rem,var(--radix-popover-content-available-height))] w-(--radix-popover-trigger-width) flex-col overflow-hidden rounded-lg border p-1 shadow-2xl"
    >
      {/* Header with Segmented Filter Pills */}
      <div className="border-border/20 flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-2.5 py-1.5">
        <div className="flex items-center gap-1.5">
          <span className="bg-accent/15 text-accent flex h-4.5 w-4.5 items-center justify-center rounded font-mono text-[11px] font-bold">
            @
          </span>
          <span className="text-text-main text-[11px] font-semibold tracking-tight">
            Add Context
          </span>
        </div>

        {/* Segmented filter pills */}
        <div className="border-border/20 bg-surface-secondary/40 flex items-center rounded-lg border p-0.5">
          {(['all', 'file', 'folder', 'git'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setFilterType(tab)}
              className={cn(
                'cursor-pointer rounded-md px-2 py-0.5 text-[10px] font-medium capitalize transition-all duration-150 select-none',
                filterType === tab
                  ? 'border-border/40 bg-surface text-text-main font-semibold shadow-xs'
                  : 'text-text-muted hover:text-text-main',
              )}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Items List */}
      <div className="custom-scrollbar flex max-h-64 min-h-0 flex-col gap-0.5 overflow-y-auto p-1">
        {isLoading && items.length === 0 ? (
          <div className="text-text-muted flex items-center justify-center gap-2 py-8 text-xs font-medium">
            <Loader2 className="text-accent h-4 w-4 animate-spin" />
            <span>Searching workspace...</span>
          </div>
        ) : items.length === 0 ? (
          <div className="text-text-muted py-8 text-center text-xs">
            No matching files or git context found.
          </div>
        ) : (
          items.map((item, index) => {
            const isActive = index === activeIndex;
            return (
              <button
                key={item.id}
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                type="button"
                onClick={() => onSelectItem(item)}
                className={cn(
                  'group/item flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors duration-150 select-none',
                  isActive
                    ? 'bg-accent/15 text-text-main shadow-xs'
                    : 'text-text-muted hover:text-text-main hover:bg-white/5',
                )}
              >
                <div
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors',
                    isActive ? 'bg-accent/20' : 'bg-surface-secondary/70',
                  )}
                >
                  {renderDropdownIcon(item)}
                </div>

                <div className="flex min-w-0 flex-1 flex-col">
                  <span
                    className={cn(
                      'truncate font-mono text-xs font-medium',
                      isActive ? 'text-accent' : 'text-text-main',
                    )}
                  >
                    {item.title}
                  </span>
                  {item.subtitle && (
                    <span className="text-text-muted/50 truncate font-mono text-[10px]">
                      {item.subtitle}
                    </span>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="border-border/30 bg-surface-secondary/60 text-text-muted/60 rounded border px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase">
                    {item.type}
                  </span>
                  {isActive && (
                    <CornerDownLeft className="text-accent/80 h-3 w-3 shrink-0 opacity-80" />
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Keyboard navigation helper footer */}
      <div className="border-border/15 bg-surface-secondary/20 text-text-muted/50 flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-2.5 py-1.5 text-[10px]">
        <span className="truncate">Attach file, folder, or git diff</span>
        <div className="flex items-center gap-2 font-mono text-[9px]">
          <span className="flex items-center gap-1">
            <kbd className="border-border/40 bg-surface text-text-muted rounded border px-1 py-0.5">
              ↑↓
            </kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="border-border/40 bg-surface text-text-muted rounded border px-1 py-0.5">
              ↵
            </kbd>
            attach
          </span>
          <span className="flex items-center gap-1">
            <kbd className="border-border/40 bg-surface text-text-muted rounded border px-1 py-0.5">
              Esc
            </kbd>
            close
          </span>
        </div>
      </div>
    </PopoverContent>
  );
}
