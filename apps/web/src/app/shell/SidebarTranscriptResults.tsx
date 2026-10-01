import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { searchSessionEvents, type SearchResultItem } from '@agentctl/api-client';
import type { SearchEventType } from '@agentctl/shared';
import { MessageSquare, Wrench, BrainCircuit, Loader2, SearchX, RotateCw } from 'lucide-react';
import { AgentIcon, RelativeTime } from '@/shared';
import { cn } from '@agentctl/ui';

interface SidebarTranscriptResultsProps {
  searchQuery: string;
  onSelectResult: (sessionId: string, eventId: number) => void;
}

type EventFilterType = 'all' | SearchEventType;

const FILTER_TYPES: { id: EventFilterType; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'user', label: 'User' },
  { id: 'agent', label: 'Agent' },
  { id: 'tool', label: 'Tool' },
  { id: 'thought', label: 'Thought' },
];

function getEventBadge(type: SearchEventType) {
  switch (type) {
    case 'user':
      return {
        label: 'User',
        icon: MessageSquare,
        color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
      };
    case 'tool':
      return {
        label: 'Tool',
        icon: Wrench,
        color: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
      };
    case 'thought':
      return {
        label: 'Thought',
        icon: BrainCircuit,
        color: 'text-sky-400 bg-sky-500/10 border-sky-500/20',
      };
    case 'agent':
      return {
        label: 'Agent',
        icon: AgentIcon,
        color: 'text-accent bg-accent/10 border-accent/20',
      };
  }
}

function HighlightedSnippet({ item }: { item: SearchResultItem }) {
  const { snippet, matchIndices } = item;
  const [start, end] = matchIndices;

  if (start === 0 && end === 0) {
    return <span>{snippet}</span>;
  }

  const before = snippet.substring(0, start);
  const match = snippet.substring(start, end);
  const after = snippet.substring(end);

  return (
    <span>
      {before}
      <span className="text-accent bg-accent/15 rounded-xs px-0.5 font-semibold underline underline-offset-2">
        {match}
      </span>
      {after}
    </span>
  );
}

export function SidebarTranscriptResults({
  searchQuery,
  onSelectResult,
}: SidebarTranscriptResultsProps) {
  const [activeFilter, setActiveFilter] = useState<EventFilterType>('all');
  const normalizedQuery = searchQuery.trim();
  const [debouncedQuery, setDebouncedQuery] = useState(normalizedQuery);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(normalizedQuery);
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, [normalizedQuery]);

  const {
    data: results = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['search-events', debouncedQuery, activeFilter],
    queryFn: () =>
      searchSessionEvents({
        q: debouncedQuery,
        type: activeFilter,
        limit: 30,
      }),
    enabled: debouncedQuery.length > 0,
    staleTime: 1000 * 10,
  });
  const isSearching = isLoading || normalizedQuery !== debouncedQuery;

  return (
    <div className="flex flex-col space-y-2">
      {/* Event Type Filter Pills */}
      <div className="no-scrollbar flex items-center gap-1 overflow-x-auto px-1 py-1 select-none">
        {FILTER_TYPES.map((filter) => (
          <button
            key={filter.id}
            type="button"
            onClick={() => {
              setActiveFilter(filter.id);
            }}
            className={cn(
              'shrink-0 cursor-pointer rounded-md px-2 py-0.5 text-[10.5px] font-medium transition-colors',
              activeFilter === filter.id
                ? 'bg-accent/20 text-accent font-semibold'
                : 'text-text-muted hover:text-text-main hover:bg-surface-secondary/50',
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {/* Results Content */}
      {isSearching ? (
        <div className="text-text-muted/60 flex flex-col items-center justify-center py-10">
          <Loader2 className="text-accent mb-2 h-5 w-5 animate-spin" />
          <span className="text-xs">Searching transcript messages...</span>
        </div>
      ) : isError ? (
        <div className="text-text-muted/60 flex flex-col items-center justify-center px-4 py-8 text-center">
          <p className="text-xs font-medium">Could not search transcript messages</p>
          <button
            type="button"
            onClick={() => {
              void refetch();
            }}
            className="text-accent hover:bg-accent/10 mt-2 flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors"
          >
            <RotateCw className="h-3.5 w-3.5" />
            Retry
          </button>
        </div>
      ) : results.length === 0 ? (
        <div className="text-text-muted/60 flex flex-col items-center justify-center px-4 py-8 text-center">
          <SearchX className="mb-1.5 h-5 w-5 opacity-40" />
          <p className="text-xs font-medium">No transcript matches found</p>
          <p className="text-text-muted/40 mt-0.5 text-[11px]">
            Try a different keyword or event filter
          </p>
        </div>
      ) : (
        <div className="space-y-1.5 px-0.5">
          {results.map((item) => {
            const badge = getEventBadge(item.eventType);
            const Icon = badge.icon;

            return (
              <div
                key={`${item.sessionId}-${String(item.eventId)}`}
                onClick={() => {
                  onSelectResult(item.sessionId, item.eventId);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectResult(item.sessionId, item.eventId);
                  }
                }}
                className="group border-border/20 bg-surface-secondary/20 hover:border-accent/30 hover:bg-surface-secondary/60 flex cursor-pointer flex-col gap-1.5 rounded-xl border p-2.5 text-left transition-[border-color,background-color] duration-150"
              >
                {/* Header: Project / Session + Event Type + Time */}
                <div className="flex items-center justify-between gap-1.5 text-[11px]">
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span
                      className={cn(
                        'py-0.2 inline-flex shrink-0 items-center gap-1 rounded border px-1.5 text-[9.5px] font-semibold tracking-wider uppercase',
                        badge.color,
                      )}
                    >
                      <Icon className="h-2.5 w-2.5" />
                      <span>{badge.label}</span>
                    </span>
                    <span className="text-text-muted/80 truncate font-mono text-[11px] font-medium">
                      {item.projectName}
                    </span>
                    <span className="text-text-muted/40">/</span>
                    <span className="text-text-main group-hover:text-accent truncate text-[11.5px] font-medium transition-colors">
                      {item.sessionTitle}
                    </span>
                  </div>

                  <span className="text-text-muted/40 shrink-0 font-mono text-[10px]">
                    <RelativeTime value={item.createdAt} />
                  </span>
                </div>

                {/* Body: Matched snippet */}
                <div className="text-text-muted/80 group-hover:text-text-main/90 line-clamp-2 font-mono text-[11px] leading-relaxed transition-colors">
                  <HighlightedSnippet item={item} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
