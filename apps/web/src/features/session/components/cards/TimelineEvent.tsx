import type { ReactNode } from 'react';

interface TimelineEventProps {
  dotColor: string;
  isPulsing?: boolean;
  children: ReactNode;
}

export function TimelineEvent({ dotColor, isPulsing = false, children }: TimelineEventProps) {
  return (
    <div className="group/timeline-event relative flex w-full gap-3 py-2.5">
      {/* Left column for track and dot (automatically stretches to 100% row height) */}
      <div className="relative w-3 shrink-0 select-none">
        {/* Track line segment centered horizontally */}
        <div className="bg-accent/15 absolute top-0 bottom-0 left-1/2 w-[1px] -translate-x-1/2" />

        {/* Glowing dot centered horizontally and positioned at top offset */}
        <div className="absolute top-[10px] left-1/2 z-10 flex h-1.5 w-1.5 -translate-x-1/2 items-center justify-center overflow-visible">
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
