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
    estimateSize: () => 60,
    overscan: 10,
  });

  useEffect(() => {
    if (autoScroll && events.length > 0) {
      virtualizer.scrollToIndex(events.length - 1, { align: 'end' });
    }
  }, [events.length, autoScroll, virtualizer]);

  const handleScroll = () => {
    if (!parentRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = parentRef.current;
    const isBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isBottom);
  };

  if (events.length === 0) {
    return (
      <div className="bg-background flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <div className="h-4 w-4 animate-spin border-2 border-white border-t-transparent" />
          <span className="text-text-muted text-[10px] font-bold tracking-widest">
            INITIALIZING_TERMINAL...
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="stream-viewport relative h-full flex-1 overflow-y-auto scroll-smooth"
      ref={parentRef}
      onScroll={handleScroll}
    >
      <div className="relative mx-auto max-w-4xl py-8">
        <div className="absolute top-0 bottom-0 left-10 z-0 w-px bg-white/5" />

        <div
          style={{
            height: `${String(virtualizer.getTotalSize())}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const e = events[item.index];
            const nextEvent = events[item.index + 1];
            
            // Layout logic: tight spacing for tool call sequences
            const isConsecutiveTool = e.type === 'tool_call' && nextEvent.type === 'tool_call';
            const spacingClass = isConsecutiveTool ? 'pb-1' : 'pb-6';

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
                className={`${spacingClass} animate-in fade-in slide-in-from-top-1 duration-150 ease-out`}
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
          className="terminal-button fixed bottom-24 left-1/2 -translate-x-1/2 shadow-2xl"
          onClick={() => {
            setAutoScroll(true);
          }}
        >
          RETURN_TO_LATEST
        </button>
      )}
    </div>
  );
}

