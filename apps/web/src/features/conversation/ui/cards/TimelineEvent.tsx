import type { ReactNode } from 'react';

export type TimelinePosition = 'first' | 'last' | 'only' | 'middle';

interface TimelineEventProps {
  dotColor: string;
  isPulsing?: boolean;
  position?: TimelinePosition;
  children: ReactNode;
}

export function TimelineEvent({
  dotColor,
  isPulsing = false,
  position = 'middle',
  children,
}: TimelineEventProps) {
  const isFirst = position === 'first';
  const isLast = position === 'last';
  const isOnly = position === 'only';
  return (
    <div className="group/timeline-event relative flex w-full gap-3 py-2.5">
      {/* Left gutter container */}
      <div className="relative w-5 shrink-0 select-none">
        {/* Top vertical trunk line */}
        {!isOnly && !isFirst && (
          <div
            data-testid="timeline-top-trunk"
            className="border-border/30 absolute top-0 bottom-1/2 left-[9px] w-px border-l"
          />
        )}

        {/* Bottom vertical trunk line */}
        {!isOnly && !isLast && (
          <div
            data-testid="timeline-bottom-trunk"
            className="border-border/30 absolute top-1/2 bottom-0 left-[9px] w-px border-l"
          />
        )}

        {/* Horizontal branch arm for last item curve (└─) */}
        {!isOnly && isLast && (
          <div
            data-testid="timeline-branch-arm"
            className="border-border/30 absolute top-0 bottom-1/2 left-[9px] w-2 rounded-bl-sm border-b border-l"
          />
        )}

        {/* Centered node dot */}
        <div className="absolute top-1/2 left-[9px] z-10 flex h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 items-center justify-center">
          {isPulsing && (
            <span
              className={`animate-pulse-scale absolute h-3.5 w-3.5 rounded-full opacity-35 ${dotColor} shrink-0`}
            />
          )}
          <span
            className={`border-background h-1.5 w-1.5 rounded-full border ${dotColor} aspect-square shrink-0`}
          />
        </div>
      </div>

      {/* Content wrapper */}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
