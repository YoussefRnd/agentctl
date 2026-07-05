import type { ReactNode } from 'react';
import React from 'react';
import { cn } from '../utils.js';

export interface CardProps {
  children: ReactNode;
  className?: string;
  status?: 'default' | 'success' | 'warning' | 'error' | 'pending';
  intensity?: 'default' | 'high';
}

const STATUS_CLASSES = {
  default: 'bg-surface/30 border-border/50 hover:border-accent/20 hover:bg-surface/50',
  success:
    'bg-emerald-500/5 border-emerald-500/20 hover:border-emerald-500/40 hover:bg-emerald-500/10',
  warning: 'bg-warning/5 border-warning/20 hover:border-warning/40 hover:bg-warning/10',
  error: 'bg-rose-500/5 border-rose-500/20 hover:border-rose-500/40 hover:bg-rose-500/10',
  pending:
    'bg-surface-secondary/10 border-border/20 opacity-70 hover:opacity-100 hover:border-accent/20',
};

export const Card = ({
  children,
  className = '',
  status = 'default',
  intensity = 'default',
}: CardProps) => {
  return (
    <div
      className={cn(
        'liquid-glass flex flex-col overflow-hidden rounded-lg border transition-all duration-200',
        intensity === 'high' && 'bg-surface/40 backdrop-blur-[32px]',
        STATUS_CLASSES[status],
        className,
      )}
    >
      {children}
    </div>
  );
};

export const CardHeader = ({
  children,
  className = '',
}: Omit<CardProps, 'status' | 'intensity'>) => (
  <div className={cn('border-border bg-surface-secondary/50 border-b px-3 py-2', className)}>
    {children}
  </div>
);

export const CardContent = ({
  children,
  className = '',
}: Omit<CardProps, 'status' | 'intensity'>) => (
  <div className={cn('p-3.5', className)}>{children}</div>
);

export const CardFooter = ({
  children,
  className = '',
}: Omit<CardProps, 'status' | 'intensity'>) => (
  <div className={cn('border-border bg-surface-tertiary/30 border-t px-3 py-2', className)}>
    {children}
  </div>
);
