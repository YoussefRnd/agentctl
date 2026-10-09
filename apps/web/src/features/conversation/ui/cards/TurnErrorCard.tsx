import { Button, Card } from '@agentctl/ui';
import { AlertCircle, RefreshCw, RotateCcw, Settings2 } from 'lucide-react';
import { chatErrorSchema, presentProviderError } from '@agentctl/shared';

interface TurnErrorCardProps {
  message?: string;
  failure?: unknown;
  onRetry?: () => void;
  onProviderSettings?: () => void;
  onRefresh?: () => void;
  pending?: boolean;
}

export function TurnErrorCard({
  message,
  failure,
  onRetry,
  onProviderSettings,
  onRefresh,
  pending,
}: TurnErrorCardProps) {
  const normalized = chatErrorSchema.safeParse(failure);
  const error = presentProviderError(normalized.success ? normalized.data : (failure ?? message));
  const actions = normalized.success
    ? normalized.data.actions
    : onRefresh
      ? ['refresh_session']
      : [];
  return (
    <div role="alert">
      <Card status="error" className="my-2 flex flex-col gap-2 p-4">
        <div className="text-danger flex items-center gap-2">
          <AlertCircle className="icon-default shrink-0" aria-hidden="true" />
          <span className="text-role-title">{error.title}</span>
        </div>
        <p className="text-text-muted text-role-body [overflow-wrap:anywhere]">{error.message}</p>
        {normalized.success && normalized.data.delivery === 'unknown' && (
          <p className="text-warning text-role-caption">
            Delivery is unconfirmed. The queue is paused; this message was not resent.
          </p>
        )}
        {actions.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {actions.includes('provider_settings') && onProviderSettings && (
              <Button variant="outline" size="sm" onClick={onProviderSettings}>
                <Settings2 className="icon-compact" aria-hidden="true" />
                Provider settings
              </Button>
            )}
            {actions.includes('retry') &&
              onRetry &&
              normalized.success &&
              ['not_sent', 'rejected'].includes(normalized.data.delivery) && (
                <Button variant="outline" size="sm" disabled={pending} onClick={onRetry}>
                  <RotateCcw className="icon-compact" aria-hidden="true" />
                  Retry message
                </Button>
              )}
            {actions.includes('refresh_session') && onRefresh && (
              <Button variant="ghost" size="sm" disabled={pending} onClick={onRefresh}>
                <RefreshCw className="icon-compact" aria-hidden="true" />
                Refresh session
              </Button>
            )}
          </div>
        )}
        {error.details && (
          <details className="text-text-muted text-role-caption">
            <summary className="motion-disclosure w-fit cursor-pointer">Provider details</summary>
            <p className="mt-2 max-h-32 overflow-auto [overflow-wrap:anywhere] whitespace-pre-wrap">
              {error.details}
            </p>
          </details>
        )}
      </Card>
    </div>
  );
}
