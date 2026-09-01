import React, { useEffect, useRef } from 'react';
import { FileCode, Folder, Sparkles, Loader2 } from 'lucide-react';
import { cn } from '@agentctl/ui';
import { DiffIcon, GitBranchIcon, GitCommitIcon } from '@primer/octicons-react';
import type { ContextItem, ContextItemType } from '@agentctl/api-client';

interface ContextDropdownProps {
  isOpen: boolean;
  items: ContextItem[];
  isLoading: boolean;
  activeIndex: number;
  onSelectItem: (item: ContextItem) => void;
  filterType: 'all' | ContextItemType;
  setFilterType: (type: 'all' | ContextItemType) => void;
}

function renderDropdownIcon(type: ContextItemType, id: string) {
  if (type === 'file') {
    return <FileCode className="h-4 w-4 shrink-0 text-cyan-400" />;
  }
  if (type === 'folder') {
    return <Folder className="h-4 w-4 shrink-0 text-amber-400" />;
  }
  if (type === 'git') {
    if (id === 'git:diff') return <DiffIcon className="h-4 w-4 shrink-0 text-purple-400" />;
    if (id === 'git:staged') return <GitBranchIcon className="h-4 w-4 shrink-0 text-emerald-400" />;
    if (id === 'git:log') return <GitCommitIcon className="h-4 w-4 shrink-0 text-blue-400" />;
    return <GitBranchIcon className="h-4 w-4 shrink-0 text-purple-400" />;
  }
  return <Sparkles className="text-accent h-4 w-4 shrink-0" />;
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
    <div className="border-border/40 bg-brand-mantle/95 absolute bottom-full left-0 z-50 mb-3 flex max-h-80 w-full flex-col overflow-hidden rounded-xl border p-1.5 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl">
      {/* Top Filter Category Tabs */}
      <div className="border-border/30 bg-surface-secondary/30 flex items-center gap-1 border-b px-2 py-1.5 text-xs">
        <span className="text-text-muted/70 font-mono text-[10px] tracking-wider uppercase">
          Context
        </span>
        <div className="ml-auto flex items-center gap-1">
          {(['all', 'file', 'folder', 'git'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setFilterType(tab)}
              className={cn(
                'rounded px-2 py-0.5 text-[10px] font-medium capitalize transition-colors duration-150',
                filterType === tab
                  ? 'bg-accent/20 text-accent font-semibold'
                  : 'text-text-muted/70 hover:text-text-main hover:bg-surface-secondary/50',
              )}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Items List */}
      <div className="flex max-h-64 [scrollbar-width:thin] flex-col gap-0.5 overflow-y-auto p-1">
        {isLoading && items.length === 0 ? (
          <div className="text-text-muted flex items-center justify-center gap-2 py-6 text-xs">
            <Loader2 className="text-accent h-4 w-4 animate-spin" />
            <span>Searching workspace...</span>
          </div>
        ) : items.length === 0 ? (
          <div className="text-text-muted py-6 text-center text-xs">
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
                  'group/item flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors duration-150',
                  isActive
                    ? 'bg-accent/15 border-accent/30 text-text-main border shadow-sm'
                    : 'hover:bg-surface-secondary/60 text-text-muted hover:text-text-main border border-transparent',
                )}
              >
                {renderDropdownIcon(item.type, item.id)}

                <div className="flex min-w-0 flex-1 flex-col">
                  <span
                    className={cn(
                      'truncate font-mono text-xs font-semibold',
                      isActive ? 'text-accent' : 'text-text-main',
                    )}
                  >
                    {item.title}
                  </span>
                  {item.subtitle && (
                    <span className="text-text-muted/60 truncate font-mono text-[10px]">
                      {item.subtitle}
                    </span>
                  )}
                </div>

                <span className="bg-surface-secondary/60 text-text-muted/70 border-border/30 shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium uppercase">
                  {item.type}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
