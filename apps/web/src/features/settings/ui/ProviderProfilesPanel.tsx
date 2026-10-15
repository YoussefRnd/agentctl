import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { providerService } from '@agentctl/api-client';
import { findAgentConfigOption, type CustomModel, type ProviderDiscovery } from '@agentctl/shared';
import { Button, Input, Select } from '@agentctl/ui';
import { toast } from 'sonner';
import { providerKeys } from '@/shared/lib/queryKeys';

export function ProviderProfilesPanel({ providers }: { providers: ProviderDiscovery[] }) {
  const queryClient = useQueryClient();
  const [providerId, setProviderId] = useState('');
  const provider = providers.find((item) => item.id === providerId);
  const [name, setName] = useState('');
  const [customModels, setCustomModels] = useState<CustomModel[]>([]);
  const [modelId, setModelId] = useState('');
  const [modelName, setModelName] = useState('');
  const [modelContext, setModelContext] = useState('');
  const [protocol, setProtocol] = useState('auto');
  const [model, setModel] = useState('');
  const [thinking, setThinking] = useState('');
  const [busy, setBusy] = useState(false);
  const [environment, setEnvironment] = useState<
    {
      key: string;
      value: string;
      changed: boolean;
      removed: boolean;
      changedBeforeRemove?: boolean;
    }[]
  >([]);
  const [newEnvironmentKey, setNewEnvironmentKey] = useState('');
  useEffect(() => {
    setCustomModels(provider?.customModels ?? []);
    setModelId('');
    setModelName('');
    setModelContext('');
    setProtocol(provider?.protocol ?? 'auto');
    setModel(provider?.defaultModel ?? '');
    setThinking(provider?.defaultThinkingEffort ?? '');
    setEnvironment(
      Object.keys(provider?.customEnvConfigured ?? {}).map((key) => ({
        key,
        value: '',
        changed: false,
        removed: false,
      })),
    );
    setNewEnvironmentKey('');
  }, [provider]);
  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await operation();
      await queryClient.invalidateQueries({ queryKey: providerKeys.all });
      await queryClient.invalidateQueries({ queryKey: providerKeys.registry });
      toast.success('Provider configuration saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save provider configuration');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="border-border/40 space-y-3 rounded-xl border p-4">
      <p className="text-sm font-semibold">Provider profiles</p>
      <p className="text-text-muted text-xs">
        Create named profiles with separate credentials and defaults. Profiles share the installed
        agent. For agents using a global login, configure a separate account directory through their
        environment settings below.
      </p>
      <Select
        value={providerId}
        disabled={busy}
        onChange={setProviderId}
        placeholder="Choose a provider or profile"
        options={providers
          .filter((item) => item.installState !== 'not_installed')
          .map((item) => ({ value: item.id, label: item.label }))}
      />
      {provider && (
        <>
          <div className="flex gap-2">
            <Input
              aria-label="New profile name"
              placeholder="New profile name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <Button
              size="sm"
              disabled={busy || !name.trim()}
              onClick={() =>
                void run(async () => {
                  const created = await providerService.createProfile(providerId, name.trim());
                  setProviderId(created.id);
                  setName('');
                })
              }
            >
              Create profile
            </Button>
          </div>
          <label className="block space-y-1 text-xs">
            Protocol
            <Select
              value={protocol}
              onChange={setProtocol}
              options={[
                { value: 'auto', label: 'Automatic' },
                { value: 'v1', label: 'ACP v1' },
                { value: 'v2', label: 'ACP v2 (experimental)' },
              ]}
            />
          </label>
          <label className="block space-y-1 text-xs">
            Default model
            <Select
              value={model}
              onChange={setModel}
              options={[
                { value: '', label: 'Agent default' },
                ...[
                  ...(findAgentConfigOption(provider.configOptions, 'model')?.options ?? []).filter(
                    (item) => !provider.customModels?.some((custom) => custom.id === item.value),
                  ),
                  ...customModels.map((item) => ({ value: item.id, name: item.name })),
                ].map((item) => ({ value: item.value, label: item.name })),
              ]}
            />
          </label>
          <div className="space-y-2 text-xs">
            <p className="font-semibold">Custom models</p>
            <p className="text-text-muted">
              Add model IDs accepted by the agent that are missing from its model list.
            </p>
            {customModels.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-2">
                <span>
                  {item.name} <span className="text-text-muted">({item.id})</span>
                  {item.contextWindow ? ` · ${item.contextWindow} tokens` : ''}
                </span>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setCustomModels((models) => models.filter((entry) => entry.id !== item.id));
                    if (model === item.id) setModel('');
                  }}
                >
                  Remove model
                </Button>
              </div>
            ))}
            <Input
              aria-label="Custom model ID"
              placeholder="Model ID"
              value={modelId}
              disabled={busy}
              onChange={(event) => setModelId(event.target.value)}
            />
            <Input
              aria-label="Custom model name"
              placeholder="Display name (optional)"
              value={modelName}
              disabled={busy}
              onChange={(event) => setModelName(event.target.value)}
            />
            <Input
              aria-label="Custom model context window"
              placeholder="Context window in tokens (optional)"
              type="number"
              value={modelContext}
              disabled={busy}
              onChange={(event) => setModelContext(event.target.value)}
            />
            <Button
              size="sm"
              disabled={
                busy ||
                !modelId.trim() ||
                modelId.trim().length > 256 ||
                modelName.trim().length > 100 ||
                customModels.length >= 100 ||
                customModels.some((item) => item.id === modelId.trim()) ||
                (!!modelContext &&
                  (!Number.isInteger(Number(modelContext)) ||
                    Number(modelContext) <= 0 ||
                    Number(modelContext) > 100000000))
              }
              onClick={() => {
                setCustomModels((models) => [
                  ...models,
                  {
                    id: modelId.trim(),
                    name: modelName.trim() || modelId.trim().slice(0, 100),
                    ...(modelContext ? { contextWindow: Number(modelContext) } : {}),
                  },
                ]);
                setModelId('');
                setModelName('');
                setModelContext('');
              }}
            >
              Add model
            </Button>
          </div>
          <label className="block space-y-1 text-xs">
            Default thinking effort
            <Select
              value={thinking}
              onChange={setThinking}
              options={[
                { value: '', label: 'Agent default' },
                ...(
                  findAgentConfigOption(provider?.configOptions, 'thought_level')?.options ?? []
                ).map((option) => ({ value: option.value, label: option.name })),
              ]}
            />
          </label>

          <div className="space-y-2">
            <p className="text-xs font-semibold">Environment variables</p>
            {environment.map((entry) => (
              <div key={entry.key} className="flex items-center gap-2">
                <label className="min-w-0 flex-1 space-y-1 text-xs">
                  {entry.key}
                  <Input
                    type="password"
                    aria-label={`Value for ${entry.key}`}
                    disabled={busy || entry.removed}
                    value={entry.value}
                    autoComplete="off"
                    placeholder={
                      entry.removed
                        ? 'Will be removed'
                        : provider.customEnvConfigured?.[entry.key]
                          ? 'Configured — enter a replacement'
                          : 'Enter value'
                    }
                    onChange={(event) =>
                      setEnvironment((rows) =>
                        rows.map((row) =>
                          row.key === entry.key
                            ? { ...row, value: event.target.value, changed: true }
                            : row,
                        ),
                      )
                    }
                  />
                </label>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    setEnvironment((rows) =>
                      rows.map((row) =>
                        row.key === entry.key
                          ? row.removed
                            ? { ...row, removed: false, changed: row.changedBeforeRemove ?? false }
                            : {
                                ...row,
                                removed: true,
                                changed: true,
                                changedBeforeRemove: row.changed,
                              }
                          : row,
                      ),
                    )
                  }
                >
                  {entry.removed ? 'Undo' : 'Remove'}
                </Button>
              </div>
            ))}
            <div className="flex gap-2">
              <Input
                aria-label="Environment variable name"
                placeholder="Variable name, e.g. AGENT_HOME"
                disabled={busy}
                value={newEnvironmentKey}
                onChange={(event) => setNewEnvironmentKey(event.target.value)}
              />
              <Button
                size="sm"
                disabled={
                  busy ||
                  !/^[A-Za-z_][A-Za-z0-9_]*$/.test(newEnvironmentKey) ||
                  environment.some((row) => row.key === newEnvironmentKey)
                }
                onClick={() => {
                  setEnvironment((rows) => [
                    ...rows,
                    { key: newEnvironmentKey, value: '', changed: false, removed: false },
                  ]);
                  setNewEnvironmentKey('');
                }}
              >
                Add variable
              </Button>
            </div>
          </div>
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void run(() =>
                providerService.updateConfig(
                  providerId,
                  environment.some((row) => row.changed)
                    ? Object.fromEntries(
                        environment
                          .filter((row) => row.changed)
                          .map((row) => [row.key, row.removed ? '' : row.value]),
                      )
                    : undefined,
                  undefined,
                  {
                    customModels,
                    protocol: protocol as 'auto' | 'v1' | 'v2',
                    defaultModel: model,
                    defaultThinkingEffort: thinking,
                  },
                ),
              )
            }
          >
            Save configuration
          </Button>
        </>
      )}
    </div>
  );
}
