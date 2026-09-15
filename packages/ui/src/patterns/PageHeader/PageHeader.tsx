import * as React from 'react';
import { cn } from '../../utils.js';

export interface PageHeaderProps {
  title: React.ReactNode;
  breadcrumbs?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, breadcrumbs, subtitle, actions, className }: PageHeaderProps) {
  return (
    <div
      className={cn(
        'border-border/40 bg-surface-secondary/20 flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3',
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        {breadcrumbs && <div className="text-text-muted/60 text-[11px]">{breadcrumbs}</div>}
        <h1 className="text-text-main truncate text-sm font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-text-muted/70 text-xs">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
