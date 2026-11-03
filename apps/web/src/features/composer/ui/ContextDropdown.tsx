import { useEffect, useRef } from 'react';
import { Folder, Code2, Check, Search, AlertCircle } from 'lucide-react';
import { cn, Spinner } from '@agentctl/ui';
import { DiffIcon, GitBranchIcon, GitCommitIcon } from '@primer/octicons-react';
import type { ContextItem, ContextItemType } from '@agentctl/api-client';
import { FileIcon } from '@/shared';
import {
  SuggestionDropdown,
  SuggestionHeader,
  SuggestionList,
  SuggestionOption,
  SuggestionFooter,
} from './SuggestionDropdown';

interface ContextDropdownProps {
  isOpen: boolean;
  items: ContextItem[];
  isLoading: boolean;
  searchError: boolean;
  query: string;
  listboxId: string;
  attachedContexts: ContextItem[];
  onActiveIndexChange: (index: number) => void;
  onDismiss: () => void;
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

const filters = [
  { type: 'all', label: 'All' },
  { type: 'file', label: 'Files' },
  { type: 'folder', label: 'Folders' },
  { type: 'git', label: 'Git' },
] as const;

export function ContextDropdown({
  isOpen,
  items,
  isLoading,
  searchError,
  query,
  listboxId,
  attachedContexts,
  activeIndex,
  onActiveIndexChange,
  onDismiss,
  onSelectItem,
  filterType,
  setFilterType,
}: ContextDropdownProps) {
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (isOpen) itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [isOpen, activeIndex, items]);

  if (!isOpen) return null;

  return (
    <SuggestionDropdown label="Context suggestions" onDismiss={onDismiss}>
      <SuggestionHeader
        symbol="@"
        title="Add context"
        description="Search workspace files, folders, and Git"
        trailing={
          attachedContexts.length > 0 ? (
            <span className="bg-accent/10 text-accent rounded-full px-2 py-1 text-[11px]">
              {attachedContexts.length} attached
            </span>
          ) : undefined
        }
      />

      <div
        role="group"
        aria-label="Filter context"
        className="flex shrink-0 items-center gap-1 px-3 pt-2.5 pb-2"
      >
        {filters.map(({ type, label }) => (
          <button
            key={type}
            type="button"
            aria-pressed={filterType === type}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setFilterType(type)}
            className={cn(
              'focus-visible:ring-accent cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none',
              filterType === type
                ? 'bg-accent/15 text-accent'
                : 'text-text-muted hover:bg-surface-secondary hover:text-text-main',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <SuggestionList id={listboxId} label="Workspace context" loading={isLoading}>
        {items.map((item, index) => {
          const attached = attachedContexts.some((context) => context.id === item.id);
          return (
            <SuggestionOption
              key={item.id}
              id={`${listboxId}-option-${index}`}
              active={index === activeIndex}
              accessibleLabel={`${item.title}${item.subtitle ? `, ${item.subtitle}` : ''}${attached ? ', already attached' : ''}`}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              title={item.title}
              description={item.subtitle}
              query={query}
              icon={renderDropdownIcon(item)}
              onActivate={() => onActiveIndexChange(index)}
              onSelect={() => onSelectItem(item)}
              trailing={
                attached ? (
                  <span className="text-accent flex shrink-0 items-center gap-1 text-[11px]">
                    <Check aria-hidden="true" className="h-3.5 w-3.5" />
                    Attached
                  </span>
                ) : undefined
              }
            />
          );
        })}
      </SuggestionList>

      {items.length === 0 && (
        <div
          role="status"
          className="text-text-muted flex flex-col items-center gap-2 px-4 pt-3 pb-7 text-center text-xs"
        >
          {isLoading ? (
            <>
              <Spinner aria-hidden="true" className="text-accent icon-prominent" />
              <p>Searching workspace…</p>
            </>
          ) : searchError ? (
            <>
              <AlertCircle aria-hidden="true" className="h-5 w-5" />
              <p>Couldn’t search this workspace.</p>
              <p className="text-[11px]">Edit your search or switch filters to try again.</p>
            </>
          ) : (
            <>
              <Search aria-hidden="true" className="h-5 w-5" />
              <p>{query ? <>No matches for “{query}”</> : 'No context available.'}</p>
              <p className="text-[11px]">Try a file name, path, or another filter.</p>
            </>
          )}
        </div>
      )}

      <SuggestionFooter count={items.length} action="attach" loading={isLoading} />
    </SuggestionDropdown>
  );
}
