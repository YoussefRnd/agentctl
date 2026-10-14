import type { ReactNode, TextareaHTMLAttributes } from 'react';
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@agentctl/ui';
import { SyncIcon } from '@primer/octicons-react';

/** Keep the form scrollable while its recovery and submit actions stay reachable. */
export function GitDialogContent({
  children,
  footer,
  busy = false,
}: {
  children: ReactNode;
  footer: ReactNode;
  busy?: boolean;
}) {
  return (
    <DialogContent
      showCloseButton={!busy}
      className="flex max-h-[calc(100dvh-2rem)] max-w-lg flex-col gap-0 overflow-hidden p-0"
    >
      <div className="min-h-0 min-w-0 space-y-4 overflow-y-auto p-5">{children}</div>
      <div className="border-border/20 flex shrink-0 flex-wrap items-center justify-end gap-2 border-t px-5 py-3">
        {footer}
      </div>
    </DialogContent>
  );
}

export function GitDialogHeader({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <DialogHeader className="pr-6">
      <div className="bg-accent/10 text-accent mb-2 flex h-9 w-9 items-center justify-center rounded-xl">
        {icon}
      </div>
      <DialogTitle className="text-text-main text-lg font-semibold">{title}</DialogTitle>
      <DialogDescription className="text-text-muted text-xs">{description}</DialogDescription>
    </DialogHeader>
  );
}

export function GitDraftButton({
  pending,
  disabled,
  onClick,
  label = 'Generate message',
}: {
  pending: boolean;
  disabled?: boolean;
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      className="text-accent inline-flex items-center gap-1 text-xs disabled:opacity-40"
      disabled={disabled || pending}
      onClick={onClick}
    >
      {pending && <SyncIcon className="h-3.5 w-3.5 animate-spin" />}
      {pending ? 'Generating…' : label}
    </button>
  );
}

export function GitMessageEditor({
  label = 'Commit message',
  action,
  hint,
  rows = 4,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  id: string;
  label?: string;
  action?: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={props.id} className="text-text-main text-xs font-medium">
          {label}
        </label>
        {action}
      </div>
      <textarea
        {...props}
        rows={rows}
        className="border-border/30 bg-background/40 text-text-main placeholder:text-text-muted/50 focus:border-accent/50 block w-full min-w-0 resize-y rounded-lg border px-3 py-2 font-mono text-xs leading-relaxed outline-none disabled:opacity-50"
      />
      {hint && <p className="text-text-muted text-xs [overflow-wrap:anywhere]">{hint}</p>}
    </div>
  );
}

export function GitDialogNotice({
  children,
  tone = 'error',
}: {
  children: ReactNode;
  tone?: 'error' | 'warning' | 'muted';
}) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={
        tone === 'error'
          ? 'border-danger/20 bg-danger/10 text-danger rounded-lg border p-3 text-xs [overflow-wrap:anywhere]'
          : tone === 'warning'
            ? 'text-warning text-xs [overflow-wrap:anywhere]'
            : 'text-text-muted text-xs [overflow-wrap:anywhere]'
      }
    >
      {children}
    </p>
  );
}
