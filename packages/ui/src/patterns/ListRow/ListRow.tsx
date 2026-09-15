import * as React from 'react';
import { cn } from '../../utils.js';

export interface ListRowProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  onClick?: (e: React.MouseEvent) => void;
  isActive?: boolean;
  icon?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  href?: string;
  target?: string;
  rel?: string;
  as?: React.ElementType;
}

export function ListRow({
  onClick,
  isActive = false,
  icon,
  title,
  subtitle,
  meta,
  actions,
  className,
  href,
  target,
  rel,
  as,
  ...rest
}: ListRowProps) {
  const Component = as ?? (href ? 'a' : onClick ? 'button' : 'div');
  const isInteractive =
    Component === 'a' ||
    Component === 'button' ||
    Boolean(onClick) ||
    Boolean(href) ||
    as !== undefined;

  return (
    <div
      className={cn(
        'group/row relative flex items-center justify-between rounded-lg transition-colors duration-100',
        isActive
          ? 'bg-surface-secondary text-text-main font-semibold'
          : 'text-text-muted hover:bg-surface-secondary/50 hover:text-text-main',
        className,
      )}
    >
      <Component
        {...rest}
        type={Component === 'button' ? 'button' : undefined}
        href={Component === 'a' || as ? href : undefined}
        target={target}
        rel={rel}
        onClick={onClick}
        className={cn(
          'focus-visible:ring-accent/40 flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs outline-none select-none focus-visible:ring-1',
          isInteractive && 'cursor-pointer',
        )}
      >
        {icon && (
          <span className="text-text-muted/70 group-hover/row:text-text-main shrink-0">{icon}</span>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="truncate text-xs">{title}</div>
          {subtitle && <div className="text-text-muted/60 truncate text-[10.5px]">{subtitle}</div>}
        </div>
        {meta && <span className="text-text-muted/50 shrink-0 text-[10px]">{meta}</span>}
      </Component>

      {actions && (
        <div className="absolute right-1.5 flex items-center gap-1 opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 has-[[data-state=open]]:opacity-100">
          {actions}
        </div>
      )}
    </div>
  );
}
