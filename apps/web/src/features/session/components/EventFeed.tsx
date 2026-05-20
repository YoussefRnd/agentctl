import { useRef, useEffect, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { TextCard } from './cards/TextCard';
import { ToolCallCard } from './cards/ToolCallCard';
import type { ACPEventRow } from '@agentctl/shared';

export function EventFeed({ events }: { events: ACPEventRow[] }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 100,
    overscan: 5,
  });

  useEffect(() => {
    if (autoScroll && events.length > 0) {
      virtualizer.scrollToIndex(events.length - 1, { align: 'end' });
    }
  }, [events.length, autoScroll, virtualizer]);

  const handleScroll = () => {
    if (!parentRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = parentRef.current;
    const isBottom = scrollHeight - scrollTop - clientHeight < 100;
    setAutoScroll(isBottom);
  };

  if (events.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="bg-surface border-border flex h-12 w-12 items-center justify-center rounded-full border">
            <div className="border-accent h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
          </div>
          <span className="text-text-muted text-[13px] font-medium tracking-wide">
            WAITING FOR AGENT
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative h-full flex-1 overflow-y-auto scroll-smooth px-4 sm:px-0"
      ref={parentRef}
      onScroll={handleScroll}
    >
      <div className="relative mx-auto max-w-3xl py-8">
        <div className="absolute top-0 bottom-0 left-8 z-0 w-px bg-gradient-to-b from-transparent via-white/10 to-transparent" />

        <div
          style={{
            height: `${String(virtualizer.getTotalSize())}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const e = events[item.index];
            return (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${String(item.start)}px)`,
                }}
                className="transition-opacity duration-300"
              >
                {e.type === 'text' && <TextCard content={e.data.content} />}
                {e.type === 'tool_call' && <ToolCallCard tool={e.data.name} payload={e.data} />}
              </div>
            );
          })}
        </div>
      </div>

      {!autoScroll && (
        <button
          type="button"
          className="bg-surface/80 border-border text-text-main hover:bg-surface animate-in fade-in slide-in-from-bottom-2 fixed bottom-32 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border px-4 py-2 text-[11px] font-bold shadow-xl backdrop-blur-md transition-all"
          onClick={() => {
            setAutoScroll(true);
          }}
        >
          <span className="bg-accent h-1.5 w-1.5 animate-pulse rounded-full" />
          LATEST MESSAGES
        </button>
      )}
    </div>
  );
}
