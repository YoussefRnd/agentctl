import { cn } from '../utils';

export interface SpinnerProps {
  className?: string;
  size?: number | string;
}

export interface ThinkingSpinnerProps {
  done?: boolean;
  className?: string;
  size?: number | string;
}

/** Standard UI loading spinner for general loading states (data fetching, page transitions, buttons) */
export function Spinner({ className, size }: SpinnerProps) {
  return (
    <svg
      className={cn('text-text-muted/70 h-4 w-4 animate-spin', className)}
      style={size === undefined ? undefined : { width: size, height: size }}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      role="status"
      aria-label="Loading"
    >
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

/** Signature AgentCtl Thinking Control Node glyph for chat thinking & turn progress states */
export function ThinkingSpinner({ done = false, className, size }: ThinkingSpinnerProps) {
  if (done) {
    return null;
  }

  return (
    <span
      className={cn(
        'text-accent inline-flex shrink-0 items-center justify-center select-none',
        className,
      )}
      aria-label="Thinking"
      role="status"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        xmlns="http://www.w3.org/2000/svg"
        className="h-[15px] w-[15px] animate-[ai-think-spin_3.5s_cubic-bezier(0.45,0.05,0.55,0.95)_infinite] motion-reduce:animate-none"
        style={size === undefined ? undefined : { width: size, height: size }}
      >
        <path d="M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41l-7.59-7.59a2.41 2.41 0 0 0-3.41 0Z" />
        <path d="M12 7.5 7.5 12 12 16.5 16.5 12Z" strokeWidth="1.5" />
        <circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
}
