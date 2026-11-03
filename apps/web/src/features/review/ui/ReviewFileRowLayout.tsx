import type { ReactNode, ComponentPropsWithRef } from 'react';
import { cn } from '@agentctl/ui';

type Props = Omit<ComponentPropsWithRef<'div'>, 'title'> & {
  collapsed: boolean;
  icon: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions: ReactNode;
  filePath?: string;
  onToggle?: () => void;
};

export function ReviewFileRowLayout({
  collapsed,
  icon,
  title,
  subtitle,
  actions,
  filePath,
  onToggle,
  children,
  className,
  ...props
}: Props) {
  const Summary = onToggle ? 'button' : 'div';
  return (
    <div {...props} className={cn('border-border/10 border-b', className)}>
      <div
        className={cn(
          'group/filerow border-border/20 bg-surface sticky top-0 z-10 flex w-full items-center justify-between border-b transition-colors',
          !collapsed
            ? 'border-l-accent/80 bg-surface-secondary border-l-2 shadow-xs'
            : 'hover:bg-surface-secondary/25',
        )}
      >
        <Summary
          type={onToggle ? 'button' : undefined}
          title={filePath}
          aria-label={filePath ? `Toggle diff for ${filePath}` : undefined}
          aria-expanded={onToggle ? !collapsed : undefined}
          onClick={onToggle}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-3 py-2 text-left select-none"
        >
          <div className="relative flex h-4 w-4 shrink-0 items-center justify-center">{icon}</div>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-text-main truncate font-mono text-xs font-medium">{title}</span>
            {subtitle && (
              <span className="text-text-muted/50 truncate font-mono text-[10px]">{subtitle}</span>
            )}
          </span>
        </Summary>
        <div className="flex shrink-0 items-center gap-2 pr-3 select-none">{actions}</div>
      </div>
      {children}
    </div>
  );
}
