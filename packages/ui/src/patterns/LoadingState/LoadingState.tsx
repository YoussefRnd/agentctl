import { cn } from '../../utils.js';
import { Spinner } from '../../components/Spinner.js';

export interface LoadingStateProps {
  message?: string;
  className?: string;
  variant?: 'panel' | 'inline';
}

export function LoadingState({
  message = 'Loading…',
  className,
  variant = 'panel',
}: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={cn(
        'text-text-muted',
        variant === 'inline'
          ? 'text-role-control flex min-w-0 items-center gap-2'
          : 'text-role-body flex min-w-0 flex-col items-center justify-center gap-2.5 p-8 text-center',
        className,
      )}
    >
      <Spinner
        aria-hidden="true"
        className={variant === 'inline' ? 'icon-compact' : 'icon-prominent'}
      />
      {message && <span className="min-w-0 [overflow-wrap:anywhere]">{message}</span>}
    </div>
  );
}
