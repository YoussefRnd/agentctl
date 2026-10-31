import { ArrowRight, ArrowRightLeft } from 'lucide-react';
import type { ProviderSwitchData } from '@agentctl/shared';
import { ProviderIconUrl } from '@/shared';

function Endpoint({ endpoint }: { endpoint: ProviderSwitchData['from'] }) {
  const model = endpoint.modelId === 'default' ? undefined : endpoint.modelName || endpoint.modelId;
  return (
    <span
      className="inline-flex max-w-full min-w-0 items-center gap-1.5"
      title={`${endpoint.providerName}${model ? ` · ${model}` : ''}`}
    >
      <span aria-hidden="true" className="shrink-0 [&>img]:size-3.5 [&>svg]:size-3.5">
        <ProviderIconUrl url={endpoint.providerIcon || null} />
      </span>
      <span className="text-text-main truncate font-medium">{endpoint.providerName}</span>
      {model && <span className="text-text-muted truncate">{model}</span>}
    </span>
  );
}

export function ProviderSwitchRow({ change }: { change: ProviderSwitchData }) {
  return (
    <div
      role="note"
      aria-label={`Provider switched from ${change.from.providerName} to ${change.to.providerName}`}
      className="text-text-muted flex items-center gap-3 py-2 text-xs"
    >
      <span aria-hidden="true" className="border-border/60 min-w-3 flex-1 border-t" />
      <div className="flex max-w-full min-w-0 flex-wrap items-center justify-center gap-x-2 gap-y-1.5">
        <span className="inline-flex items-center gap-1.5 text-[11px] whitespace-nowrap">
          <ArrowRightLeft className="size-3" aria-hidden="true" />
          Provider switched
        </span>
        <span className="inline-flex max-w-full min-w-0 flex-wrap items-center justify-center gap-x-2 gap-y-1.5">
          <Endpoint endpoint={change.from} />
          <span className="inline-flex max-w-full min-w-0 items-center gap-2">
            <ArrowRight className="size-3 shrink-0" aria-hidden="true" />
            <span className="sr-only">to</span>
            <Endpoint endpoint={change.to} />
          </span>
        </span>
      </div>
      <span aria-hidden="true" className="border-border/60 min-w-3 flex-1 border-t" />
    </div>
  );
}
