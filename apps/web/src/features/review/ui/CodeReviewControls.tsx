import { useId } from 'react';
import {
  Button,
  IconButton,
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
  Select,
} from '@agentctl/ui';
import { GearIcon, HistoryIcon, CheckIcon, ChevronRightIcon } from '@primer/octicons-react';
import {
  findAgentConfigOption,
  withCustomModels,
  type CodeReviewRun,
  type ProviderDiscovery,
} from '@agentctl/shared';

export function reviewScopeLabel(scope: 'working' | 'session') {
  return scope === 'working' ? 'Uncommitted changes' : 'All session changes';
}
export function reviewTime(timestamp: number) {
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
export function CodeReviewOptions({
  open,
  onOpenChange,
  scope,
  onScopeChange,
  providerId,
  onProviderChange,
  modelId,
  onModelChange,
  providers,
  loading,
  error,
  onRetry,
  busy,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  scope: 'working' | 'session';
  onScopeChange(scope: 'working' | 'session'): void;
  providerId: string;
  onProviderChange(id: string): void;
  modelId: string;
  onModelChange(id: string): void;
  providers: ProviderDiscovery[];
  loading: boolean;
  error: boolean;
  onRetry(): void;
  busy: boolean;
}) {
  const id = useId();
  const available = providers.filter(
    (provider) =>
      provider.enabled &&
      !provider.hidden &&
      ['installed_local', 'system_available'].includes(provider.installState ?? ''),
  );
  const provider = available.find((provider) => provider.id === providerId);
  const models =
    findAgentConfigOption(
      withCustomModels(provider?.configOptions ?? [], provider?.customModels ?? []),
      'model',
    )?.options ?? [];
  return (
    <Popover open={open} onOpenChange={onOpenChange} modal>
      <PopoverTrigger asChild>
        <IconButton aria-label="Review options" size="compact" title="Review options">
          <GearIcon size={14} />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-4 p-4" aria-label="Review options">
        <PopoverTitle>Review options</PopoverTitle>
        <div className="space-y-1.5">
          <label htmlFor={`${id}-scope`} className="text-text-main text-xs font-medium">
            Changes to review
          </label>
          <Select
            id={`${id}-scope`}
            aria-label="Review scope"
            value={scope}
            disabled={busy}
            options={[
              { value: 'working', label: 'Uncommitted changes' },
              { value: 'session', label: 'All session changes' },
            ]}
            onChange={(value) => onScopeChange(value as 'working' | 'session')}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${id}-provider`} className="text-text-main text-xs font-medium">
            Reviewer
          </label>
          <Select
            id={`${id}-provider`}
            aria-label="Reviewer provider"
            value={providerId}
            disabled={busy || loading}
            options={[
              { value: '', label: 'Session provider and model' },
              ...(providerId && !provider
                ? [{ value: providerId, label: `${providerId} (unavailable)` }]
                : []),
              ...available.map((provider) => ({ value: provider.id, label: provider.label })),
            ]}
            onChange={onProviderChange}
          />
        </div>
        {providerId && (
          <div className="space-y-1.5">
            <label htmlFor={`${id}-model`} className="text-text-main text-xs font-medium">
              Model
            </label>
            <Select
              id={`${id}-model`}
              aria-label="Reviewer model"
              value={modelId}
              disabled={busy || !provider}
              options={[
                { value: '', label: 'Provider default' },
                ...models.map((model) => ({ value: model.value, label: model.name })),
              ]}
              onChange={onModelChange}
            />
          </div>
        )}
        {error && (
          <p role="alert" className="text-danger text-xs">
            Could not load providers.{' '}
            <button type="button" className="cursor-pointer underline" onClick={onRetry}>
              Retry
            </button>
          </p>
        )}
        {providerId && !provider && !loading && !error && (
          <p role="alert" className="text-warning text-xs">
            Choose an available reviewer before starting.
          </p>
        )}
        <div className="border-border/30 flex items-start justify-between gap-3 border-t pt-3">
          <p className="text-text-muted text-[11px] leading-relaxed">
            Reviews changes with related source context.
            <br />
            Run commands explicitly under Verification.
          </p>
          <Button type="button" size="sm" variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
export function CodeReviewHistory({
  open,
  onOpenChange,
  runs,
  selectedId,
  onSelect,
  hasOlder,
  loadingOlder,
  onLoadOlder,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  runs: CodeReviewRun[];
  selectedId?: string;
  onSelect(id: string): void;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder(): void;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange} modal>
      <PopoverTrigger asChild>
        <IconButton
          aria-label="Review history"
          size="compact"
          title="Review history"
          disabled={!runs.length}
        >
          <HistoryIcon size={14} />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2" aria-label="Review history">
        <PopoverTitle className="px-2 py-2">Review history</PopoverTitle>
        <ul className="max-h-64 space-y-0.5 overflow-y-auto">
          {runs.map((run, index) => (
            <li key={run.id}>
              <button
                type="button"
                aria-current={run.id === selectedId ? 'true' : undefined}
                title={`${reviewTime(run.startedAt)} · ${run.providerId} · ${reviewScopeLabel(run.scope)}`}
                className={`hover:bg-surface/60 flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left transition-colors ${run.id === selectedId ? 'bg-accent/10' : ''}`}
                onClick={() => {
                  onSelect(run.id);
                  onOpenChange(false);
                }}
              >
                <span className="text-accent flex w-4 shrink-0 items-center">
                  {run.id === selectedId ? (
                    <CheckIcon size={14} />
                  ) : (
                    <ChevronRightIcon className="text-text-muted/50" size={14} />
                  )}
                </span>
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="text-text-main flex flex-wrap items-center gap-x-2 text-xs">
                    <span>{reviewTime(run.startedAt)}</span>
                    {index === 0 && <span className="text-text-muted text-[10px]">Latest</span>}
                  </span>
                  <span className="text-text-muted block truncate text-[11px]">
                    {run.providerId} · {run.scope === 'working' ? 'Uncommitted' : 'Session'} ·{' '}
                    {run.status}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {hasOlder && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="mt-2 w-full"
            disabled={loadingOlder}
            onClick={onLoadOlder}
          >
            {loadingOlder ? 'Loading…' : 'Load older reviews'}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
