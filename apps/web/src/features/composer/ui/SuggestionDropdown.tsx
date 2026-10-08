import type { ReactNode, Ref } from 'react';
import { cn, PopoverContent, SearchHighlight as SuggestionHighlight } from '@agentctl/ui';
import { CornerDownLeft } from 'lucide-react';

export function SuggestionDropdown({
  label,
  onDismiss,
  children,
}: {
  label: string;
  onDismiss: () => void;
  children: ReactNode;
}) {
  return (
    <PopoverContent
      role="region"
      aria-label={label}
      side="top"
      align="start"
      sideOffset={8}
      surface="none"
      onOpenAutoFocus={(event) => event.preventDefault()}
      onCloseAutoFocus={(event) => event.preventDefault()}
      onEscapeKeyDown={(event) => {
        event.preventDefault();
        onDismiss();
      }}
      onFocusOutside={(event) => event.preventDefault()}
      onPointerDownOutside={(event) => {
        if (event.target instanceof Element && event.target.closest('textarea'))
          event.preventDefault();
        else onDismiss();
      }}
      className="border-border/50 bg-brand-mantle flex max-h-[min(24rem,var(--radix-popover-content-available-height))] w-(--radix-popover-trigger-width) flex-col overflow-hidden rounded-xl border p-0 shadow-2xl"
    >
      {children}
    </PopoverContent>
  );
}

export function SuggestionHeader({
  symbol,
  title,
  description,
  trailing,
}: {
  symbol: string;
  title: string;
  description: string;
  trailing?: ReactNode;
}) {
  return (
    <div className="border-border/30 flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-3 py-3">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="bg-accent/15 text-accent flex h-7 w-7 items-center justify-center rounded-lg font-mono text-sm"
        >
          {symbol}
        </span>
        <div>
          <p className="text-text-main text-xs font-semibold">{title}</p>
          <p className="text-text-muted mt-0.5 text-[11px]">{description}</p>
        </div>
      </div>
      {trailing}
    </div>
  );
}

export function SuggestionList({
  id,
  label,
  loading = false,
  children,
}: {
  id: string;
  label: string;
  loading?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      role="listbox"
      aria-label={label}
      aria-busy={loading}
      className="custom-scrollbar flex max-h-72 min-h-0 flex-col gap-0.5 overflow-y-auto px-2 pt-2 pb-2"
    >
      {children}
    </div>
  );
}

export function SuggestionOption({
  id,
  active,
  title,
  description,
  query,
  icon,
  trailing,
  accessibleLabel,
  highlightDescription = true,
  onActivate,
  onSelect,
  ref,
}: {
  id: string;
  active: boolean;
  title: string;
  description?: string;
  query: string;
  icon: ReactNode;
  trailing?: ReactNode;
  accessibleLabel?: string;
  highlightDescription?: boolean;
  onActivate: () => void;
  onSelect: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      id={id}
      ref={ref}
      role="option"
      aria-selected={active}
      aria-label={accessibleLabel}
      tabIndex={-1}
      title={description ? `${title} — ${description}` : title}
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onMouseMove={() => {
        if (!active) onActivate();
      }}
      onClick={onSelect}
      className={cn(
        'flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors',
        active ? 'bg-accent/10 text-text-main' : 'text-text-muted hover:bg-surface-secondary',
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
          active ? 'bg-accent/15' : 'bg-surface-secondary/70',
        )}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-text-main truncate font-mono text-xs">
          <SuggestionHighlight text={title} query={query} />
        </p>
        {description && (
          <p className="text-text-muted mt-1 truncate text-[11px]">
            <SuggestionHighlight text={description} query={highlightDescription ? query : ''} />
          </p>
        )}
      </div>
      {trailing}
      {active && !trailing && (
        <CornerDownLeft aria-hidden="true" className="text-accent h-3.5 w-3.5 shrink-0" />
      )}
    </button>
  );
}

export function SuggestionFooter({
  count,
  action,
  loading = false,
}: {
  count: number;
  action: 'attach' | 'select';
  loading?: boolean;
}) {
  return (
    <div className="border-border/30 text-text-muted flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-[11px]">
      <span role="status">
        {loading ? 'Searching…' : `${count} ${count === 1 ? 'result' : 'results'}`}
      </span>
      <div className="flex items-center gap-3">
        <span>
          <kbd className="font-mono">↑↓</kbd> navigate
        </span>
        <span>
          <kbd className="font-mono">↵ / Tab</kbd> {action}
        </span>
        <span>
          <kbd className="font-mono">Esc</kbd> close
        </span>
      </div>
    </div>
  );
}

export { SearchHighlight as SuggestionHighlight } from '@agentctl/ui';
