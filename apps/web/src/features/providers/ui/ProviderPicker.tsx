import { useState, useMemo, useRef, useEffect } from 'react';
import { Search, Check, RefreshCw } from 'lucide-react';
import { findAgentConfigOption, type ProviderDiscovery } from '@agentctl/shared';
import { getProviderEnvKeys, validateApiKey } from '@agentctl/shared';
import { ProviderIcon } from '@/shared';
import { useProviders } from '../api/useProviders.js';

export interface ProviderPickerProps {
  sessionId: string | null;
  selectedId: string | null;
  selectedModelId?: string | null;
  onSelect: (providerId: string, modelId?: string) => void;
  providers: ProviderDiscovery[];
  isOpen: boolean;
  onClose?: () => void;
  onOpenAuthModal?: () => void;
}

export function ProviderPicker({
  sessionId,
  selectedId,
  selectedModelId,
  onSelect,
  providers,
  isOpen,
  onClose: _onClose,
  onOpenAuthModal,
}: ProviderPickerProps) {
  const {
    updateProviderConfig,
    isUpdatingConfig,
    refreshProvider,
    isRefreshing,
    activate,
    isActivating,
    login,
    isLoggingIn,
    verifyProvider,
    isVerifying,
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
  const autoRefreshedRef = useRef<Set<string>>(new Set());

  const activeProvider = useMemo<ProviderDiscovery | null>(() => {
    const installedProviders = providers.filter(
      (provider) =>
        provider.installState === 'installed_local' || provider.installState === 'system_available',
    );
    return (
      installedProviders.find((provider) => provider.id === internalProviderId) ??
      installedProviders[0] ??
      null
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

    const modelOption = findAgentConfigOption(activeProvider?.configOptions, 'model');
    if (!modelOption?.options) return [];

    return modelOption.options.filter(
      (opt) =>
        opt.name.toLowerCase().includes(search.toLowerCase()) ||
        opt.value.toLowerCase().includes(search.toLowerCase()),
    );
  }, [activeProvider, search]);

  const activeProviderId = activeProvider?.id;
  const isInstalled =
    activeProvider?.installState === 'installed_local' ||
    activeProvider?.installState === 'system_available';
  const isReady =
    activeProvider?.authState === 'authenticated' || activeProvider?.authState === 'not_required';
  const modelsCount = models.length;

  useEffect(() => {
    if (
      isOpen &&
      activeProviderId &&
      isInstalled &&
      isReady &&
      modelsCount === 0 &&
      !search &&
      !isRefreshing &&
      !autoRefreshedRef.current.has(activeProviderId)
    ) {
      autoRefreshedRef.current.add(activeProviderId);
      refreshProvider(activeProviderId);
    }
  }, [
    isOpen,
    activeProviderId,
    isInstalled,
    isReady,
    modelsCount,
    search,
    isRefreshing,
    refreshProvider,
  ]);

  if (!isOpen || !activeProvider) return null;

  const isPending = isUpdatingConfig || isActivating || isLoggingIn || isVerifying;

  const handleSaveAndConnect = () => {
    const hasKeys = envKeys.length > 0;
    const keysChanged = envKeys.some((k) => keysValues[k] !== (activeProvider.customEnv[k] ?? ''));

    const proceed = () => {
      if (
        activeProvider.authState !== 'authenticated' &&
        activeProvider.authState !== 'not_required' &&
        activeProvider.authState !== 'required'
      ) {
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
      const updates = localCustomEnvs[activeProvider.id] ?? {};
      updateProviderConfig(
        { providerId: activeProvider.id, customEnv: updates },
        {
          onSuccess: () => {
            proceed();
          },
        },
      );
    } else {
      proceed();
    }
  };

  return (
    <div className="text-text-main flex w-full min-w-0 overflow-hidden [overflow-wrap:anywhere]">
      <ProviderSidebar
        providers={providers}
        internalProviderId={internalProviderId}
        setInternalProviderIdOverride={setInternalProviderIdOverride}
        setSearch={setSearch}
      />

      <div className="flex min-w-0 flex-1 flex-col bg-transparent">
        <div className="border-border/20 flex items-center gap-2 border-b p-2">
          <div className="relative min-w-0 flex-1">
            <Search className="text-text-muted absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2" />
            <input
              ref={inputRef}
              type="text"
              aria-label="Filter models"
              placeholder="Filter models..."
              className="border-border/30 bg-surface/40 text-text-main placeholder:text-text-muted/30 focus:border-accent/40 focus:ring-accent/40 h-8 w-full min-w-0 rounded-md border pr-3 pl-9 font-sans text-[11px] transition-colors duration-200 outline-none focus:ring-1"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
            />
          </div>
          <button
            type="button"
            aria-label="Refresh provider models"
            onClick={() => {
              if (activeProvider.installState !== 'not_installed') {
                refreshProvider(activeProvider.id);
              }
            }}
            disabled={isRefreshing || activeProvider.installState === 'not_installed'}
            title={
              activeProvider.installState === 'not_installed'
                ? 'Install provider to load models'
                : 'Refresh provider models'
            }
            className="text-text-muted hover:text-text-main hover:bg-text-main/5 rounded-lg p-1.5 transition-colors disabled:pointer-events-none disabled:opacity-30"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="h-[280px] space-y-1 overflow-y-auto p-1.5">
          {activeProvider.installState === 'not_installed' ||
          (activeProvider.authState !== 'authenticated' &&
            activeProvider.authState !== 'not_required') ? (
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
              onOpenAuthModal={onOpenAuthModal}
              onVerify={() => verifyProvider(activeProvider.id)}
            />
          ) : models.length === 0 ? (
            <div className="p-2">
              {isRefreshing ? (
                <div className="text-text-muted flex items-center justify-center gap-2 p-6 text-xs font-medium">
                  <RefreshCw className="text-accent h-4 w-4 animate-spin" />
                  <span>Loading available models...</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    onSelect(activeProvider.id);
                  }}
                  className="border-border/20 hover:bg-text-main/5 flex w-full flex-col rounded-lg border p-3 text-left transition-colors"
                >
                  <div className="text-text-main text-xs font-semibold">{activeProvider.label}</div>
                  <div className="text-text-muted text-[11px] font-normal">Default config</div>
                </button>
              )}
            </div>
          ) : (
            models.map((model) => {
              const isSelected =
                selectedId === activeProvider.id && selectedModelId === model.value;

              return (
                <button
                  key={model.value}
                  type="button"
                  onClick={() => {
                    onSelect(activeProvider.id, model.value);
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left transition-colors ${
                    isSelected
                      ? 'bg-accent/15 text-accent'
                      : 'text-text-muted hover:bg-text-main/5 hover:text-text-main'
                  }`}
                >
                  <div className="min-w-0">
                    <div
                      className={`truncate text-xs font-medium ${isSelected ? 'text-accent' : 'text-text-main'}`}
                    >
                      {model.name}
                    </div>
                    <div className="text-text-muted/60 text-[11px] font-normal">
                      {activeProvider.label}
                    </div>
                  </div>
                  {isSelected && <Check className="text-accent h-3.5 w-3.5 shrink-0" />}
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
      {providers.map((p) => {
        const isInstalled =
          p.installState === 'installed_local' || p.installState === 'system_available';
        if (!isInstalled) return null;
        const isSelected = p.id === internalProviderId;
        const needsAuth = p.authState === 'required' || p.authState === 'error';

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
            className={`relative flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
              isSelected
                ? 'bg-accent/15 border-accent/30 text-accent'
                : 'text-text-muted hover:bg-text-main/5 hover:text-text-main border-transparent'
            }`}
          >
            <ProviderIcon provider={p} size="sm" className="border-none bg-transparent" />
            {needsAuth && !isSelected && (
              <div className="bg-warning status-glow absolute top-0 right-0 h-1.5 w-1.5 rounded-full" />
            )}
          </button>
        );
      })}
    </div>
  );
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
  onOpenAuthModal,
  onVerify,
}: {
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
  onOpenAuthModal?: () => void;
  onVerify: () => void;
}) {
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const authMethods = activeProvider.authMethods.filter((method) => method.type !== 'env_var');
  const hasAuthMethods = authMethods.length > 0;
  const hasEnvKeys = envKeys.length > 0;

  const getKeyError = (key: string): string | null => {
    const providerLocal = localCustomEnvs[activeProvider.id] ?? {};
    const hasLocalValue = key in providerLocal;
    if (hasLocalValue) {
      return validateApiKey(key, keysValues[key] || '');
    }
    if (activeProvider.customEnvConfigured[key]) return null;
    return validateApiKey(key, keysValues[key] || '');
  };

  return (
    <div className="flex h-full flex-col items-center justify-center p-4 text-center">
      <h3 className="text-text-main mb-1 text-xs font-semibold">
        {hasAuthMethods || hasEnvKeys ? 'Authenticate' : 'Connect'} to {activeProvider.label}
      </h3>
      <p className="text-text-muted mb-4 max-w-[240px] text-xs">
        {hasAuthMethods || hasEnvKeys
          ? 'Choose one of the following authentication options:'
          : 'Check the provider connection before using it.'}
      </p>

      <div className="flex w-full max-w-[240px] flex-col gap-2 text-left">
        <div className="flex flex-col gap-2">
          {authMethods.map((method, idx) => (
            <button
              key={method.id}
              type="button"
              onClick={() => {
                if (onOpenAuthModal) {
                  onOpenAuthModal();
                } else if (method.type === 'agent') {
                  login({ providerId: activeProvider.id, methodId: method.id });
                } else {
                  setShowApiKeyInput((prev) => !prev);
                }
              }}
              disabled={isPending}
              className={`flex h-8 w-full items-center justify-center rounded-lg px-3 text-xs font-medium transition-colors disabled:opacity-30 ${
                idx === 0
                  ? 'bg-accent text-brand-crust font-semibold hover:opacity-90 active:scale-[0.98]'
                  : 'border-border/40 bg-surface-secondary/40 text-text-main hover:bg-surface-secondary/80 border'
              }`}
            >
              {isLoggingIn ? 'Authenticating...' : method.name}
            </button>
          ))}

          {hasEnvKeys && !authMethods.some((m) => m.id === 'api_key') && (
            <button
              type="button"
              onClick={() => {
                if (onOpenAuthModal) {
                  onOpenAuthModal();
                } else {
                  setShowApiKeyInput((prev) => !prev);
                }
              }}
              disabled={isPending}
              className={`border-border/40 bg-surface-secondary/40 text-text-main hover:bg-surface-secondary/80 flex h-8 w-full items-center justify-center rounded-lg border px-3 text-xs font-medium transition-colors disabled:opacity-30 ${
                !hasAuthMethods
                  ? 'bg-accent text-brand-crust border-none font-semibold hover:opacity-90'
                  : ''
              }`}
            >
              API key
            </button>
          )}

          {!hasAuthMethods && !hasEnvKeys && (
            <button
              type="button"
              onClick={onVerify}
              disabled={isPending}
              className="bg-accent text-brand-crust flex h-8 w-full items-center justify-center rounded-lg text-xs font-semibold transition-colors hover:opacity-90 disabled:opacity-30"
            >
              {isPending ? 'Checking...' : 'Check connection'}
            </button>
          )}
        </div>

        {(showApiKeyInput || (!hasAuthMethods && hasEnvKeys)) && (
          <div className="border-border/20 mt-1 space-y-2 border-t pt-2.5">
            {envKeys.map((key) => {
              const errorMsg = getKeyError(key);
              return (
                <div key={key} className="space-y-1">
                  <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-1">
                    <label htmlFor={key} className="text-text-muted font-mono text-xs">
                      {key}
                    </label>
                    {errorMsg && <span className="text-danger text-[11px]">{errorMsg}</span>}
                  </div>
                  <input
                    id={key}
                    type="password"
                    value={keysValues[key] || ''}
                    placeholder={
                      activeProvider.customEnvConfigured[key]
                        ? 'Configured (enter to replace)'
                        : `Enter ${key}...`
                    }
                    onChange={(e) => {
                      setLocalCustomEnvs({
                        ...localCustomEnvs,
                        [activeProvider.id]: {
                          ...localCustomEnvs[activeProvider.id],
                          [key]: e.target.value,
                        },
                      });
                    }}
                    className={`border-border/30 bg-surface/40 text-text-main placeholder:text-text-muted/30 focus:border-accent/40 focus:ring-accent/40 h-8 w-full min-w-0 rounded-md border px-2.5 font-mono text-xs transition-colors duration-200 outline-none focus:ring-1 ${errorMsg ? 'border-danger/40 focus:border-danger/60 focus:ring-danger/40' : ''}`}
                  />
                </div>
              );
            })}
            <button
              type="button"
              onClick={handleSaveAndConnect}
              disabled={isPending || envKeys.some((key) => getKeyError(key) !== null)}
              className="bg-accent text-brand-crust flex h-8 w-full items-center justify-center rounded-lg text-center text-xs font-semibold transition-colors hover:opacity-90 active:scale-[0.98] disabled:opacity-30"
            >
              {isPending ? 'Connecting...' : 'Save and connect'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
