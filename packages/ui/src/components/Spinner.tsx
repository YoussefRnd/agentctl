import { cn } from '../utils';

export interface SpinnerProps {
  done?: boolean;
  className?: string;
  size?: number | string;
}

export function Spinner({ done = false, className }: SpinnerProps) {
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
