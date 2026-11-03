import { ArrowRight, ArrowRightLeft } from 'lucide-react';
import type { ProviderSwitchData } from '@agentctl/shared';
import { ProviderIconUrl } from '@/shared';

function Endpoint({ endpoint }: { endpoint: ProviderSwitchData['from'] }) {
  const model = endpoint.modelId === 'default' ? undefined : endpoint.modelName || endpoint.modelId;
  return (
    <span
      className="flex min-w-0 items-center gap-2"
      title={`${endpoint.providerName}${model ? ` · ${model}` : ''}`}
    >
      <span
        aria-hidden="true"
        className="bg-text-muted text-background inline-flex shrink-0 items-center justify-center rounded-md p-0.5"
      >
        <ProviderIconUrl url={endpoint.providerIcon || null} size="inline" />
      </span>
      <span className="text-role-control min-w-0 flex-1 truncate">
        <span className="text-text-main font-medium">{endpoint.providerName}</span>
        {model && <span className="text-role-caption text-text-muted"> · {model}</span>}
      </span>
    </span>
  );
}

export function ProviderSwitchRow({ change }: { change: ProviderSwitchData }) {
  return (
    <div
      role="note"
      aria-label={`Provider switched from ${change.from.providerName} to ${change.to.providerName}`}
      className="text-role-caption text-text-muted flex min-w-0 items-center justify-center gap-2 py-2"
    >
      <span className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap">
        <ArrowRightLeft className="icon-inline" aria-hidden="true" />
        <span>Provider switched</span>
      </span>
      <Endpoint endpoint={change.from} />
      <ArrowRight className="icon-inline shrink-0" aria-hidden="true" />
      <span className="sr-only">to</span>
      <Endpoint endpoint={change.to} />
    </div>
  );
}
