import { cn } from '../utils';

export interface ProgressProps {
  label: string;
  value?: number | null;
  className?: string;
}

export function Progress({ label, value, className }: ProgressProps) {
  const percent =
    typeof value === 'number' && Number.isFinite(value)
      ? Math.min(100, Math.max(0, value))
      : undefined;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={cn('bg-border/40 h-1.5 overflow-hidden rounded-full', className)}
    >
      <div
        className={cn(
          'bg-accent h-full rounded-full transition-[width] duration-200 motion-reduce:transition-none',
          percent === undefined && 'w-1/3 animate-pulse motion-reduce:animate-none',
        )}
        style={percent === undefined ? undefined : { width: `${percent}%` }}
      />
    </div>
  );
}
