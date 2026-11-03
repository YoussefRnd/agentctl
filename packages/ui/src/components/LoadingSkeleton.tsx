import type { ReactNode } from 'react';
import { useSkeletonPending } from './SkeletonSurface.js';

/** One accessible status for a group of decorative placeholders. */
export function LoadingSkeleton({
  children,
  message = 'Loading…',
  className,
}: {
  children: ReactNode;
  message?: string;
  className?: string;
}) {
  const inherited = useSkeletonPending();
  if (inherited) return <div className={className}>{children}</div>;
  return (
    <div role="status" aria-live="polite" aria-atomic="true">
      <span className="sr-only">{message}</span>
      <div aria-hidden="true" inert className={className}>
        {children}
      </div>
    </div>
  );
}
