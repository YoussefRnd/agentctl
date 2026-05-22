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
          <div className="h-4 w-4 animate-spin border-2 border-accent border-t-transparent" />
          <span className="text-text-muted font-display text-[10px] font-bold tracking-widest uppercase">
            INITIALIZING_TERMINAL...
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="stream-viewport relative h-full flex-1 overflow-y-auto scroll-smooth pb-20"
      ref={parentRef}
      onScroll={handleScroll}
    >
      <div className="relative max-w-[1200px] pl-10 pr-6 lg:pl-16 py-12">
        <div className="absolute top-0 bottom-0 left-10 lg:left-16 z-0 w-px bg-gradient-to-b from-transparent via-border/50 to-transparent" />

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
            const isConsecutiveTool = e.type === 'tool_call' && item.index < events.length - 1 && nextEvent.type === 'tool_call';
            const spacingClass = isConsecutiveTool ? 'pb-2' : 'pb-10';

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
                className={`${spacingClass} animate-in fade-in slide-in-from-top-2 duration-300 ease-out`}
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
          className="terminal-button !bg-accent !text-background fixed bottom-32 left-1/2 -translate-x-1/2 shadow-[0_0_25px_rgba(203,166,247,0.3)] hover:scale-105 active:scale-95 z-50 backdrop-blur-md"
          onClick={() => {
            setAutoScroll(true);
          }}
        >
          <span className="font-accent font-black tracking-tighter text-[10px]">RETURN_TO_LATEST</span>
        </button>
      )}
    </div>
  );
}

