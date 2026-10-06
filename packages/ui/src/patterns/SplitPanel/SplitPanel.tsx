import * as React from 'react';
import { cn } from '../../utils.js';

export interface SplitPanelProps {
  primary: React.ReactNode;
  secondary: React.ReactNode;
  isSecondaryOpen?: boolean;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
  primaryClassName?: string;
  secondaryClassName?: string;
}

export function SplitPanel({
  primary,
  secondary,
  isSecondaryOpen = true,
  orientation = 'horizontal',
  className,
  primaryClassName,
  secondaryClassName,
}: SplitPanelProps) {
  const isHorizontal = orientation === 'horizontal';

  return (
    <div
      className={cn(
        'flex h-full min-h-0 w-full min-w-0 overflow-hidden',
        isHorizontal ? 'flex-row' : 'flex-col',
        className,
      )}
    >
      <div className={cn('min-h-0 min-w-0 flex-1 overflow-auto', primaryClassName)}>{primary}</div>
      {isSecondaryOpen && (
        <div
          className={cn(
            'border-border/40 min-h-0 min-w-0 shrink-0 overflow-auto',
            isHorizontal ? 'max-w-full border-l' : 'max-h-full border-t',
            secondaryClassName,
          )}
        >
          {secondary}
        </div>
      )}
    </div>
  );
}
