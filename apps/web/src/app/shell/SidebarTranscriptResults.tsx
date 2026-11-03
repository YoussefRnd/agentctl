import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { searchSessionEvents, type SearchResultItem } from '@agentctl/api-client';
import type { SearchEventType } from '@agentctl/shared';
import { MessageSquare, Wrench, BrainCircuit, SearchX, RotateCw } from 'lucide-react';
import { AgentIcon, RelativeTime } from '@/shared';
import { Button, cn, LoadingState } from '@agentctl/ui';

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
        color: 'text-text-muted',
      };
    case 'tool':
      return {
        label: 'Tool',
        icon: Wrench,
        color: 'text-text-muted',
      };
    case 'thought':
      return {
        label: 'Thought',
        icon: BrainCircuit,
        color: 'text-text-muted',
      };
    case 'agent':
      return {
        label: 'Agent',
        icon: AgentIcon,
        color: 'text-text-muted',
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
      <span className="text-text-main bg-accent/15 rounded-sm px-0.5 font-medium">{match}</span>
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
      <div className="no-scrollbar flex items-center gap-1 overflow-x-auto py-1 select-none">
        {FILTER_TYPES.map((filter) => (
          <button
            key={filter.id}
            type="button"
            onClick={() => {
              setActiveFilter(filter.id);
            }}
            className={cn(
              'text-role-control control-compact motion-disclosure focus-visible:ring-accent/40 shrink-0 cursor-pointer rounded-md focus-visible:ring-2 focus-visible:outline-none',
              activeFilter === filter.id
                ? 'bg-surface-tertiary/60 text-text-main'
                : 'text-text-muted hover:text-text-main hover:bg-surface-secondary/50',
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {/* Results Content */}
      {isSearching ? (
        <LoadingState message="Searching messages…" className="py-10" />
      ) : isError ? (
        <div className="text-text-muted flex flex-col items-center justify-center px-4 py-8 text-center">
          <p className="text-role-control">Could not search transcript messages</p>
          <Button
            type="button"
            variant="ghost"
            size="compact"
            onClick={() => {
              void refetch();
            }}
            className="mt-2 gap-2"
          >
            <RotateCw className="icon-compact" />
            Retry
          </Button>
        </div>
      ) : results.length === 0 ? (
        <div className="text-text-muted flex flex-col items-center justify-center px-4 py-8 text-center">
          <SearchX className="mb-1.5 h-5 w-5 opacity-40" />
          <p className="text-role-control">No transcript matches found</p>
          <p className="text-role-caption text-text-muted mt-1">
            Try a different keyword or event filter
          </p>
        </div>
      ) : (
        <div className="space-y-2">
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
                className="motion-disclosure group border-border/30 hover:bg-surface-secondary/60 focus-visible:ring-accent/40 flex min-w-0 cursor-pointer flex-col gap-2 rounded-lg border p-3 text-left focus-visible:ring-2 focus-visible:outline-none"
              >
                {/* Header: Project / Session + Event Type + Time */}
                <div className="text-role-label flex items-center justify-between gap-2 font-normal">
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span
                      className={cn(
                        'text-role-caption inline-flex shrink-0 items-center gap-1',
                        badge.color,
                      )}
                    >
                      <Icon className="icon-inline" />
                      <span>{badge.label}</span>
                    </span>
                    <span className="text-text-muted truncate font-mono">{item.projectName}</span>
                    <span className="text-text-muted">/</span>
                    <span className="text-text-main truncate font-medium">{item.sessionTitle}</span>
                  </div>

                  <span className="text-role-caption text-text-muted shrink-0 tabular-nums">
                    <RelativeTime value={item.createdAt} />
                  </span>
                </div>

                {/* Body: Matched snippet */}
                <div className="text-role-code text-text-muted line-clamp-2 leading-relaxed">
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
