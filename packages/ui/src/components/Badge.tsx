import type { ReactNode } from 'react';
import { cn } from '../utils';

export type BadgeVariant =
  | 'default'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger'
  | 'outline'
  | 'surface';

export type BadgeSize = 'sm' | 'md';

export interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  size?: BadgeSize;
  dot?: boolean;
  pulse?: boolean;
  className?: string;
}

const variantStyles: Record<BadgeVariant, { container: string; dot: string }> = {
  default: {
    container: 'bg-surface-secondary/80 text-text-muted border-border/40',
    dot: 'bg-text-muted/60',
  },
  accent: {
    container: 'bg-accent/10 text-accent border-accent/25',
    dot: 'bg-accent',
  },
  success: {
    container: 'bg-brand-green/10 text-brand-green border-brand-green/25',
    dot: 'bg-brand-green',
  },
  warning: {
    container: 'bg-brand-peach/10 text-brand-peach border-brand-peach/25',
    dot: 'bg-brand-peach',
  },
  danger: {
    container: 'bg-brand-red/10 text-brand-red border-brand-red/25',
    dot: 'bg-brand-red',
  },
  outline: {
    container: 'bg-transparent text-text-main border-border/60',
    dot: 'bg-text-main',
  },
  surface: {
    container: 'bg-surface text-text-main border-border/30 shadow-xs',
    dot: 'bg-brand-mauve',
  },
};

const sizeStyles: Record<BadgeSize, string> = {
  sm: 'px-1.5 py-0.5 text-[10px] gap-1',
  md: 'px-2 py-0.5 text-[11px] gap-1.5',
};

export function Badge({
  children,
  variant = 'default',
  size = 'sm',
  dot = false,
  pulse = false,
  className,
}: BadgeProps) {
  const styles = variantStyles[variant];

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-medium transition-colors select-none',
        styles.container,
        sizeStyles[size],
        className,
      )}
    >
      {dot && (
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          {pulse && (
            <span
              className={cn(
                'absolute inline-flex h-full w-full animate-ping rounded-full opacity-75',
                styles.dot,
              )}
            />
          )}
          <span className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', styles.dot)} />
        </span>
      )}
      {children}
    </span>
  );
}
