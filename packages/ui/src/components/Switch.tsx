import * as React from 'react';
import { cn } from '../utils.js';

interface SwitchProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  size?: 'sm' | 'md';
}

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ className, checked, onCheckedChange, size = 'md', ...props }, ref) => {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        ref={ref}
        onClick={(e) => {
          props.onClick?.(e);
          onCheckedChange?.(!checked);
        }}
        className={cn(
          'relative inline-flex shrink-0 cursor-pointer rounded-full border transition-colors duration-200 ease-in-out focus:outline-none focus:ring-1 focus:ring-accent/40',
          checked ? 'bg-accent border-accent' : 'bg-background border-border/30',
          size === 'sm' ? 'h-4 w-8' : 'h-5 w-9',
          className
        )}
        {...props}
      >
        <span
          className={cn(
            'pointer-events-none inline-block transform rounded-full transition duration-200 ease-in-out',
            checked ? 'bg-brand-crust' : 'bg-text-muted/30',
            size === 'sm'
              ? cn('h-3 w-3', checked ? 'translate-x-4' : 'translate-x-0')
              : cn('h-4 w-4', checked ? 'translate-x-4' : 'translate-x-0')
          )}
        />
      </button>
    );
  }
);

Switch.displayName = 'Switch';
