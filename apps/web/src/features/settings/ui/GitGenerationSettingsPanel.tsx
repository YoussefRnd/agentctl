import { GitGenerationSettingsLayout } from './GeneralSettingsLayout';
import { Select } from '@agentctl/ui';
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
    <GitGenerationSettingsLayout
      provider={
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
      }
      model={
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
      }
    >
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
    </GitGenerationSettingsLayout>
  );
}
