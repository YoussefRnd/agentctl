import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '../../utils.js';

export interface SwitchProps extends React.ComponentPropsWithRef<typeof SwitchPrimitive.Root> {
  size?: 'sm' | 'md' | 'compact' | 'default';
}

export const Switch = ({ className, size = 'default', ref, ...props }: SwitchProps) => {
  const isSm = size === 'sm' || size === 'compact';

  return (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        'focus-visible:ring-accent/40 relative inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 transition-colors duration-150 ease-out select-none focus-visible:ring-1 focus-visible:outline-none active:opacity-90 disabled:cursor-not-allowed disabled:opacity-40',
        isSm ? 'h-4 w-8' : 'h-5 w-9',
        'data-[state=checked]:bg-accent data-[state=checked]:border-accent',
        'data-[state=unchecked]:bg-surface-secondary/40 data-[state=unchecked]:border-border/30 data-[state=unchecked]:hover:bg-surface-secondary/60 data-[state=unchecked]:hover:border-border/40',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block rounded-full bg-white shadow-sm transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] will-change-transform data-[state=unchecked]:translate-x-0',
          isSm
            ? 'h-3 w-3 data-[state=checked]:translate-x-4'
            : 'h-4 w-4 data-[state=checked]:translate-x-4',
        )}
      />
    </SwitchPrimitive.Root>
  );
};

Switch.displayName = 'Switch';
