import { useState, useMemo, useRef, useEffect } from 'react';
import { Search, Zap, RefreshCw } from 'lucide-react';
import type { ProviderDiscovery } from '@agentctl/shared';
import { getProviderEnvKeys, validateApiKey } from '@agentctl/shared';
import { ProviderIcon } from '@/shared/ProviderIcon';
import { useProviders } from '../../../hooks/useProviders';

interface ProviderPickerProps {
  sessionId: string | null;
  selectedId: string | null;
  selectedModelId?: string | null;
  onSelect: (providerId: string, modelId?: string) => void;
  providers: ProviderDiscovery[];
  isOpen: boolean;
  onClose?: () => void;
}

export function ProviderPicker({
  sessionId,
  selectedId,
  selectedModelId,
  onSelect,
  providers,
  isOpen,
  onClose: _onClose,
}: ProviderPickerProps) {
  const {
    updateProviderConfig,
    isUpdatingConfig,
    refreshProvider,
    isRefreshing,
    toggleProvider,
    isToggling,
    activate,
    isActivating,
    login,
    isLoggingIn,
  } = useProviders(sessionId);
  const [search, setSearch] = useState('');
  const [internalProviderIdOverride, setInternalProviderIdOverride] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const internalProviderId = internalProviderIdOverride ?? selectedId;
  const [localCustomEnvs, setLocalCustomEnvs] = useState<
    Record<string, Record<string, string> | undefined>
  >({});

  const activeProvider = useMemo<ProviderDiscovery | null>(() => {
    return (
      providers.find((p) => p.id === internalProviderId) ??
      (providers.length > 0 ? providers[0] : null)
    );
  }, [providers, internalProviderId]);

  const envKeys = useMemo(() => {
    if (!activeProvider) return [];
    return getProviderEnvKeys(activeProvider);
  }, [activeProvider]);

  const keysValues = useMemo(() => {
    if (!activeProvider) return {};
    const values: Record<string, string> = {};
    for (const key of envKeys) {
      values[key] =
        localCustomEnvs[activeProvider.id]?.[key] ?? (activeProvider.customEnv[key] || '');
    }
    return values;
  }, [activeProvider, envKeys, localCustomEnvs]);

  const models = useMemo(() => {
    if (!activeProvider) return [];

    const modelOption = activeProvider.configOptions?.find(
      (opt) => opt.id === 'model' || opt.id === 'selectedModel',
    );
    if (!modelOption?.options) return [];

    return modelOption.options.filter(
      (opt) =>
        opt.name.toLowerCase().includes(search.toLowerCase()) ||
        opt.value.toLowerCase().includes(search.toLowerCase()),
    );
  }, [activeProvider, search]);

  if (!isOpen || !activeProvider) return null;

  const isPending = isUpdatingConfig || isToggling || isActivating || isLoggingIn;

  const handleSaveAndConnect = () => {
    const hasKeys = envKeys.length > 0;
    const keysChanged = envKeys.some((k) => keysValues[k] !== (activeProvider.customEnv[k] ?? ''));

    const proceedWithEnable = () => {
      if (!activeProvider.enabled) {
        toggleProvider(
          { providerId: activeProvider.id, enabled: true },
          {
            onSuccess: () => {
              if (activeProvider.status !== 'ready' && activeProvider.status !== 'needs_auth') {
                activate(activeProvider.id, {
                  onSuccess: () => {
                    onSelect(activeProvider.id);
                  },
                });
              } else {
                onSelect(activeProvider.id);
              }
            },
          },
        );
      } else if (activeProvider.status !== 'ready' && activeProvider.status !== 'needs_auth') {
        activate(activeProvider.id, {
          onSuccess: () => {
            onSelect(activeProvider.id);
          },
        });
      } else {
        onSelect(activeProvider.id);
      }
    };

    if (hasKeys && keysChanged) {
      updateProviderConfig(
        { providerId: activeProvider.id, customEnv: keysValues },
        {
          onSuccess: () => {
            proceedWithEnable();
          },
        },
      );
    } else {
      proceedWithEnable();
    }
  };

  return (
    <div className="text-text-main flex w-full overflow-hidden">
      <ProviderSidebar
        providers={providers}
        internalProviderId={internalProviderId}
        setInternalProviderIdOverride={setInternalProviderIdOverride}
        setSearch={setSearch}
      />

      <div className="flex min-w-0 flex-1 flex-col bg-transparent">
        <div className="border-border/20 flex items-center gap-2 border-b p-2">
          <div className="relative flex-1">
            <Search className="text-text-muted absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2" />
            <input
              ref={inputRef}
              type="text"
              aria-label="Filter models"
              placeholder="Filter models..."
              className="border-border/30 bg-surface/40 text-text-main placeholder:text-text-muted/30 focus:border-accent/40 focus:ring-accent/40 h-8 w-full rounded-lg border pr-3 pl-9 font-sans text-[11px] transition-all duration-200 outline-none focus:ring-1"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
            />
          </div>
          <button
            type="button"
            onClick={() => {
              refreshProvider(activeProvider.id);
            }}
            disabled={isRefreshing}
            className="text-text-muted hover:text-text-main hover:bg-text-main/5 rounded-lg p-1.5 transition-colors disabled:opacity-30"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="h-[280px] space-y-1 overflow-y-auto p-1.5">
          {activeProvider.status === 'needs_auth' || !activeProvider.enabled ? (
            <ProviderSetupPanel
              activeProvider={activeProvider}
              envKeys={envKeys}
              keysValues={keysValues}
              localCustomEnvs={localCustomEnvs}
              setLocalCustomEnvs={setLocalCustomEnvs}
              isPending={isPending}
              isLoggingIn={isLoggingIn}
              login={login}
              handleSaveAndConnect={handleSaveAndConnect}
            />
          ) : models.length === 0 ? (
            <div className="p-2">
              <button
                type="button"
                onClick={() => {
                  onSelect(activeProvider.id);
                }}
                className="border-border/20 hover:bg-text-main/5 flex w-full flex-col rounded-lg border p-3 text-left transition-all"
              >
                <div className="text-text-main text-[11px] font-black tracking-wider uppercase">
                  {activeProvider.label}
                </div>
                <div className="text-text-muted caption-3xs">
                  DEFAULT CONFIG
                </div>
              </button>
            </div>
          ) : (
            models.map((model, _i) => {
              const isSelected =
                selectedId === activeProvider.id && selectedModelId === model.value;

              return (
                <button
                  key={model.value}
                  type="button"
                  onClick={() => {
                    onSelect(activeProvider.id, model.value);
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-all ${
                    isSelected
                      ? 'bg-accent/15 text-accent'
                      : 'text-text-muted hover:bg-text-main/5 hover:text-text-main'
                  }`}
                >
                  <div className="min-w-0">
                    <div
                      className={`truncate text-[11px] font-bold tracking-wider uppercase ${isSelected ? 'text-accent' : 'text-text-main'}`}
                    >
                      {model.name}
                    </div>
                    <div className="text-text-muted/50 text-[9px] font-bold tracking-tighter uppercase">
                      {activeProvider.label}
                    </div>
                  </div>
                  {isSelected && <Zap className="fill-accent text-accent h-3 w-3" />}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

interface ProviderSidebarProps {
  providers: ProviderDiscovery[];
  internalProviderId: string | null;
  setInternalProviderIdOverride: (id: string | null) => void;
  setSearch: (search: string) => void;
}

function ProviderSidebar({
  providers,
  internalProviderId,
  setInternalProviderIdOverride,
  setSearch,
}: ProviderSidebarProps) {
  return (
    <div className="border-border/30 bg-surface-secondary/20 flex w-12 shrink-0 flex-col items-center gap-2 border-r py-2">
      {providers.filter((p) => p.enabled).map((p) => {
        const isSelected = p.id === internalProviderId;
        const needsAuth = p.status === 'needs_auth';

        return (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setInternalProviderIdOverride(p.id);
              setSearch('');
            }}
            title={p.label}
            aria-label={p.label}
            className={`relative flex h-8 w-8 items-center justify-center rounded-lg border transition-all ${
              isSelected
                ? 'bg-accent/15 border-accent/30 text-accent'
                : 'text-text-muted hover:bg-text-main/5 hover:text-text-main border-transparent'
            }`}
          >
            <ProviderIcon provider={p} size="sm" className="bg-transparent border-none" />
            {needsAuth && !isSelected && (
              <div className="bg-warning status-glow absolute top-0 right-0 h-1.5 w-1.5 rounded-full" />
            )}
          </button>
        );
      })}
    </div>
  );
}

interface ProviderSetupPanelProps {
  activeProvider: ProviderDiscovery;
  envKeys: string[];
  keysValues: Record<string, string>;
  localCustomEnvs: Record<string, Record<string, string> | undefined>;
  setLocalCustomEnvs: React.Dispatch<
    React.SetStateAction<Record<string, Record<string, string> | undefined>>
  >;
  isPending: boolean;
  isLoggingIn: boolean;
  login: (args: { providerId: string; methodId: string }) => void;
  handleSaveAndConnect: () => void;
}

function ProviderSetupPanel({
  activeProvider,
  envKeys,
  keysValues,
  localCustomEnvs,
  setLocalCustomEnvs,
  isPending,
  isLoggingIn,
  login,
  handleSaveAndConnect,
}: ProviderSetupPanelProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center p-4 text-center">
      <h3 className="text-text-main mb-1 text-[11px] font-black tracking-wider uppercase">
        {!activeProvider.enabled ? 'Setup Required' : 'Authentication Required'}
      </h3>
      <p className="text-text-muted mb-4 max-w-[240px] caption-2xs">
        Configure and enable {activeProvider.label}.
      </p>

      <div className="flex w-full max-w-[240px] flex-col gap-3 text-left">
        {envKeys.map((key) => {
          const errorMsg = validateApiKey(key, keysValues[key] || '');
          return (
            <div key={key} className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <label
                  htmlFor={key}
                  className="text-text-muted label-3xs"
                >
                  {key}
                </label>
                {errorMsg && (
                  <span className="text-danger caption-3xs">
                    {errorMsg}
                  </span>
                )}
              </div>
              <input
                id={key}
                type="password"
                value={keysValues[key] || ''}
                placeholder={`Enter ${key}...`}
                onChange={(e) => {
                  setLocalCustomEnvs({
                    ...localCustomEnvs,
                    [activeProvider.id]: {
                      ...(localCustomEnvs[activeProvider.id] ?? {}),
                      [key]: e.target.value,
                    },
                  });
                }}
                className={`border-border/30 bg-surface/40 text-text-main placeholder:text-text-muted/30 focus:border-accent/40 focus:ring-accent/40 h-8 w-full rounded-lg border px-2.5 font-sans text-[11px] transition-all duration-200 outline-none focus:ring-1 ${errorMsg ? 'border-danger/40 focus:border-danger/60 focus:ring-danger/40' : ''}`}
              />
            </div>
          );
        })}

        {activeProvider.authMethods.length > 0 && (
          <div className="mt-2 space-y-1.5">
            <span className="text-text-muted label-3xs">
              Auth Methods
            </span>
            {activeProvider.authMethods.map((method) => (
              <button
                key={method.id}
                type="button"
                onClick={() => {
                  login({ providerId: activeProvider.id, methodId: method.id });
                }}
                disabled={isPending}
                className="border-border/30 bg-surface-secondary/30 text-text-main hover:bg-text-main/5 hover:border-border/50 flex h-8 w-full items-center justify-center rounded-lg border text-center text-[10px] font-bold tracking-wider uppercase transition-all disabled:opacity-30"
              >
                {isLoggingIn ? 'AUTHENTICATING...' : `Login via ${method.name}`}
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={handleSaveAndConnect}
          disabled={
            isPending || envKeys.some((key) => validateApiKey(key, keysValues[key] || '') !== null)
          }
          className="bg-accent text-brand-crust mt-2 flex h-8 w-full items-center justify-center rounded-lg text-center text-[10px] font-bold tracking-wider uppercase transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-30"
        >
          {isPending ? 'CONNECTING...' : 'SAVE AND CONNECT'}
        </button>
      </div>
    </div>
  );
}
