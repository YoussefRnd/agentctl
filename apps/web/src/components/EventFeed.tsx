import { useRef, useEffect, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { TextCard } from './cards/TextCard.js';
import { ToolCallCard } from './cards/ToolCallCard.js';
import type { ACPEventRow } from '@agentctl/shared';

export function EventFeed({ 
  events
}: { 
  events: ACPEventRow[];
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 50, // rough estimate
  });

  // Handle scroll to bottom
  useEffect(() => {
    if (autoScroll && events.length > 0) {
      virtualizer.scrollToIndex(events.length - 1, { align: 'end' });
    }
  }, [events.length, autoScroll, virtualizer]);

  // Detect manual scroll
  const handleScroll = () => {
    if (!parentRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = parentRef.current;
    const isBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isBottom);
  };

  if (events.length === 0) return <div className="p-8 text-center text-text-muted animate-pulse">Agent Connecting...</div>;

  return (
    <div className="flex-1 overflow-y-auto p-4 relative" ref={parentRef} onScroll={handleScroll}>
      <div style={{ height: `${String(virtualizer.getTotalSize())}px`, width: '100%', position: 'relative' }}>
        {virtualizer.getVirtualItems().map((item) => {
          const e = events[item.index];
          // Simple payload typing for prototype
          const data = e.data as { content?: string; name?: string; message?: string } | null;
          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${String(item.start)}px)` }}
            >
              {e.type === 'text' && <TextCard content={data?.content ?? ''} />}
              {e.type === 'tool_call' && <ToolCallCard tool={data?.name ?? 'unknown'} payload={e.data} />}
            </div>
          );
        })}
      </div>
      {!autoScroll && (
        <div className="sticky bottom-4 left-1/2 -translate-x-1/2 bg-accent text-background px-4 py-1 rounded-full text-xs font-bold cursor-pointer" onClick={() => { setAutoScroll(true); }}>
          ⬇ New events
        </div>
      )}
    </div>
  );
}
