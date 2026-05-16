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
    estimateSize: () => 100, // Slightly larger estimate for immersive layout
    overscan: 5,
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
    const isBottom = scrollHeight - scrollTop - clientHeight < 100;
    setAutoScroll(isBottom);
  };

  if (events.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 bg-surface rounded-full flex items-center justify-center border border-border">
            <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
          <span className="text-[13px] text-text-muted font-medium tracking-wide">WAITING FOR AGENT</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 sm:px-0 relative h-full scroll-smooth" ref={parentRef} onScroll={handleScroll}>
      <div className="max-w-3xl mx-auto py-8">
        <div style={{ height: `${String(virtualizer.getTotalSize())}px`, width: '100%', position: 'relative' }}>
          {virtualizer.getVirtualItems().map((item) => {
            const e = events[item.index];
            const data = e.data as { content?: string; name?: string; message?: string } | null;
            return (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${String(item.start)}px)` }}
                className="transition-opacity duration-300"
              >
                {e.type === 'text' && <TextCard content={data?.content ?? ''} />}
                {e.type === 'tool_call' && <ToolCallCard tool={data?.name ?? 'unknown'} payload={e.data} />}
              </div>
            );
          })}
        </div>
      </div>
      
      {!autoScroll && (
        <button 
          type="button"
          className="fixed bottom-32 left-1/2 -translate-x-1/2 bg-surface/80 backdrop-blur-md border border-border text-text-main px-4 py-2 rounded-full text-[11px] font-bold shadow-xl flex items-center gap-2 hover:bg-surface transition-all animate-in fade-in slide-in-from-bottom-2" 
          onClick={() => { setAutoScroll(true); }}
        >
          <span className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse" />
          LATEST MESSAGES
        </button>
      )}
    </div>
  );
}
