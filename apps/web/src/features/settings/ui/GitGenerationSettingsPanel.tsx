import { Card, Select } from '@agentctl/ui';
import {
  findAgentConfigOption,
  withCustomModels,
  type ProviderDiscovery,
  type GitTextGenerationSettings,
} from '@agentctl/shared';
import { useRef, useState } from 'react';

interface Props {
  value: GitTextGenerationSettings | null;
  providers: ProviderDiscovery[];
  disabled?: boolean;
  onChange: (value: GitTextGenerationSettings | null) => Promise<unknown>;
}

export function GitGenerationSettingsPanel({
  value,
  providers,
  disabled = false,
  onChange,
}: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const available = providers.filter(
    (provider) =>
      provider.enabled &&
      !provider.hidden &&
      ['installed_local', 'system_available'].includes(provider.installState ?? 'not_installed'),
  );
  const provider = available.find((item) => item.id === value?.providerId);
  const options = provider
    ? (findAgentConfigOption(
        withCustomModels(provider.configOptions ?? [], provider.customModels ?? []),
        'model',
      )?.options ?? [])
    : [];
  const modelOptions = [
    ...new Map(
      options.map((item) => [item.value, { value: item.value, label: item.name }]),
    ).values(),
  ];
  const modelMissing =
    !!value?.modelId && !modelOptions.some((model) => model.value === value.modelId);
  const save = async (next: GitTextGenerationSettings | null) => {
    if (inFlight.current || disabled) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      await onChange(next);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not save the generation setting. Your previous choice is still active.',
      );
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };
  return (
    <section className="space-y-2.5" aria-labelledby="git-generation-heading">
      <h3
        id="git-generation-heading"
        className="text-text-muted px-1 text-[11px] font-bold tracking-wider uppercase"
      >
        Git text generation
      </h3>
      <Card className="space-y-4 px-5 py-4">
        <p className="text-text-muted text-xs">
          Choose the LLM for commit messages, merge messages, and PR titles and descriptions. This
          setting applies to all projects.
        </p>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <div className="min-w-0 space-y-1.5">
            <label
              htmlFor="git-generation-provider"
              className="text-text-main text-xs font-semibold"
            >
              Provider
            </label>
            <Select
              id="git-generation-provider"
              aria-label="Git generation provider"
              value={value?.providerId ?? ''}
              disabled={disabled || saving}
              options={[
                { value: '', label: 'Use session provider and model' },
                ...(value && !provider
                  ? [{ value: value.providerId, label: `${value.providerId} (unavailable)` }]
                  : []),
                ...available.map((item) => ({ value: item.id, label: item.label })),
              ]}
              onChange={(providerId) => {
                void save(providerId ? { providerId, modelId: null } : null);
              }}
            />
          </div>
          <div className="min-w-0 space-y-1.5">
            <label htmlFor="git-generation-model" className="text-text-main text-xs font-semibold">
              Model
            </label>
            <Select
              id="git-generation-model"
              aria-label="Git generation model"
              value={value?.modelId ?? ''}
              disabled={disabled || saving || !provider}
              options={[
                {
                  value: '',
                  label: value
                    ? `Provider default${provider?.defaultModel ? ` (${provider.defaultModel})` : ''}`
                    : 'Session model',
                },
                ...(modelMissing
                  ? [{ value: value!.modelId!, label: `${value!.modelId} (unavailable)` }]
                  : []),
                ...modelOptions,
              ]}
              onChange={(modelId) => {
                if (value) void save({ providerId: value.providerId, modelId: modelId || null });
              }}
            />
          </div>
        </div>
        {value && (!provider || modelMissing) && (
          <p role="alert" className="text-warning text-xs">
            This saved choice is unavailable. Choose another provider or model, or use the session
            setting. Generation will not switch providers automatically.
          </p>
        )}
        {provider && provider.status !== 'ready' && (
          <p className="text-warning text-xs">
            Connect this provider in Settings → AI Providers before generating drafts.
          </p>
        )}
        {!value && (
          <p className="text-text-muted text-xs">
            Each draft uses its session’s provider and model. Select a provider above to choose a
            dedicated model.
          </p>
        )}
        {saving && (
          <p role="status" className="text-text-muted text-xs">
            Saving generation settings…
          </p>
        )}
        {error && (
          <p role="alert" className="text-danger text-xs">
            {error}
          </p>
        )}
      </Card>
    </section>
  );
}
