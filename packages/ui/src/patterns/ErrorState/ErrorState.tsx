import * as React from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from '../../primitives/Button/index.js';
import { cn } from '../../utils.js';

export interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  retryLabel = 'Try again',
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'text-text-muted flex flex-col items-center justify-center p-6 text-center',
        className,
      )}
    >
      <div className="bg-danger/10 text-danger mb-3 rounded-full p-2.5">
        <AlertCircle className="h-5 w-5" />
      </div>
      <h3 className="text-text-main text-sm font-semibold">{title}</h3>
      {message && <p className="text-text-muted/80 mt-1 max-w-sm text-xs">{message}</p>}
      {onRetry && (
        <div className="mt-4">
          <Button variant="outline" size="compact" onClick={onRetry}>
            {retryLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
