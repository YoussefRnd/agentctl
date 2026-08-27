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
export function Spinner({ className }: SpinnerProps) {
  return (
    <svg
      className={cn('text-text-muted/70 h-4 w-4 animate-spin', className)}
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

/** Specialized AI Agent Thinking Sparkle glyph for chat thinking & turn progress states */
export function ThinkingSpinner({ done = false, className }: ThinkingSpinnerProps) {
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
        xmlns="http://www.w3.org/2000/svg"
        className="h-[15px] w-[15px] animate-[ai-think-spin_3.5s_cubic-bezier(0.45,0.05,0.55,0.95)_infinite] motion-reduce:animate-none"
      >
        {/* Primary 4-pointed radiant AI star */}
        <path
          d="M12 2C12 7.52285 7.52285 12 2 12C7.52285 12 12 16.4772 12 22C12 16.4772 16.4772 12 22 12C16.4772 12 12 7.52285 12 2Z"
          fill="currentColor"
          className="opacity-95"
        />
        {/* Secondary rotated diamond spark */}
        <path
          d="M12 5.5C12 9.08985 9.08985 12 5.5 12C9.08985 12 12 14.9101 12 18.5C12 14.9101 14.9101 12 18.5 12C14.9101 12 12 9.08985 12 5.5Z"
          fill="currentColor"
          className="origin-center rotate-45 opacity-50"
        />
        {/* Luminous Core */}
        <circle cx="12" cy="12" r="1.75" fill="white" className="opacity-90" />
      </svg>
    </span>
  );
}
