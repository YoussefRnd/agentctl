import { useState, useMemo, useEffect, useRef } from 'react';
import { Search, Bot, Cpu, Zap, RefreshCw } from 'lucide-react';
import type { ProviderDiscovery } from '@agentctl/shared';
import { PROVIDER_ENV_KEYS, validateApiKey } from '@agentctl/shared';
import { useProviders } from '../../../hooks/useProviders';

interface ProviderPickerProps {
  sessionId: string | null;
  selectedId: string | null;
  selectedModelId?: string | null;
  onSelect: (providerId: string, modelId?: string) => void;
  providers: ProviderDiscovery[];
  isOpen: boolean;
  onClose: () => void;
}

export function ProviderPicker({
  sessionId,
  selectedId,
  selectedModelId,
  onSelect,
  providers,
  isOpen,
  onClose,
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
  const [internalProviderId, setInternalProviderId] = useState<string | null>(selectedId);
  const [localCustomEnvs, setLocalCustomEnvs] = useState<
    Record<string, Record<string, string> | undefined>
  >({});
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (isOpen && pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        const target = event.target as HTMLElement;
        if (target.closest('[aria-label="Select AI provider"]')) {
          return;
        }
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) {
      setInternalProviderId(selectedId);
      setSearch('');
    }
  }, [isOpen, selectedId]);

  const activeProvider = useMemo<ProviderDiscovery | null>(() => {
    return (
      providers.find((p) => p.id === internalProviderId) ??
      (providers.length > 0 ? providers[0] : null)
    );
  }, [providers, internalProviderId]);

  const envKeys = useMemo(() => {
    if (!activeProvider) return [];
    return PROVIDER_ENV_KEYS[activeProvider.id] ?? [];
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
    <div
      ref={pickerRef}
      className="terminal-glass animate-in fade-in zoom-in-95 slide-in-from-bottom-2 absolute bottom-full left-0 z-50 mb-2 flex w-[480px] overflow-hidden border shadow-2xl"
    >
      <div className="flex w-12 shrink-0 flex-col items-center gap-2 border-r border-white/5 py-2">
        {providers.map((p) => {
          const isSelected = p.id === internalProviderId;
          const needsAuth = p.status === 'needs_auth';

          return (
            <button
              key={p.id}
              onClick={() => {
                setInternalProviderId(p.id);
                setSearch('');
              }}
              title={p.label}
              className={`relative flex h-8 w-8 items-center justify-center rounded-sm transition-all ${
                isSelected
                  ? 'bg-white text-black'
                  : 'text-text-muted hover:bg-white/5 hover:text-white'
              } ${!p.enabled ? 'opacity-40' : ''}`}
            >
              {p.icon ? (
                <img src={p.icon} alt="" className="h-4 w-4 object-contain" />
              ) : p.id.includes('claude') ? (
                <Bot className="h-4 w-4" />
              ) : (
                <Cpu className="h-4 w-4" />
              )}
              {needsAuth && !isSelected && (
                <div className="bg-warning status-glow absolute top-0 right-0 h-1.5 w-1.5 rounded-full" />
              )}
            </button>
          );
        })}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-white/5 p-2">
          <div className="relative flex-1">
            <Search className="text-text-muted absolute top-1/2 left-2.5 h-3 w-3 -translate-y-1/2" />
            <input
              type="text"
              placeholder="FIND_PROVIDER..."
              autoFocus
              className="terminal-input w-full pl-7"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
            />
          </div>
          <button
            onClick={() => {
              refreshProvider(activeProvider.id);
            }}
            disabled={isRefreshing}
            className="text-text-muted p-1 transition-colors hover:text-white disabled:opacity-30"
          >
            <RefreshCw className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="h-[280px] space-y-0.5 overflow-y-auto p-1">
          {activeProvider.status === 'needs_auth' || !activeProvider.enabled ? (
            <div className="flex h-full flex-col items-center justify-center p-4 text-center">
              <h3 className="mb-1 text-[11px] font-black text-white uppercase">
                {!activeProvider.enabled ? 'Setup Required' : 'Authentication Required'}
              </h3>
              <p className="text-text-muted mb-4 max-w-[240px] text-[10px] font-bold tracking-tight uppercase">
                Configure and enable {activeProvider.label}.
              </p>

              <div className="flex w-full max-w-[240px] flex-col gap-2 text-left">
                {envKeys.map((key) => {
                  const errorMsg = validateApiKey(key, keysValues[key] || '');
                  return (
                    <div key={key} className="space-y-1">
                      <div className="flex items-baseline justify-between">
                        <label className="text-text-muted text-[9px] font-black tracking-widest uppercase">
                          {key}
                        </label>
                        {errorMsg && (
                          <span className="text-danger text-[9px] font-bold tracking-tight uppercase">
                            {errorMsg}
                          </span>
                        )}
                      </div>
                      <input
                        type="password"
                        value={keysValues[key] || ''}
                        onChange={(e) => {
                          setLocalCustomEnvs({
                            ...localCustomEnvs,
                            [activeProvider.id]: {
                              ...(localCustomEnvs[activeProvider.id] ?? {}),
                              [key]: e.target.value,
                            },
                          });
                        }}
                        className={`terminal-input w-full ${errorMsg ? 'border-danger/40 focus:border-danger/60' : ''}`}
                      />
                    </div>
                  );
                })}

                {activeProvider.authMethods.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <span className="text-text-muted text-[9px] font-black tracking-widest uppercase">
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
                        className="terminal-button w-full border border-white/10 py-1 text-center text-[10px] uppercase transition-all hover:border-white/20"
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
                    isPending ||
                    envKeys.some((key) => validateApiKey(key, keysValues[key] || '') !== null)
                  }
                  className="terminal-button mt-2 w-full"
                >
                  {isPending ? 'CONNECTING...' : 'SAVE_AND_CONNECT'}
                </button>
              </div>
            </div>
          ) : models.length === 0 ? (
            <div className="p-2">
              <button
                onClick={() => {
                  onSelect(activeProvider.id);
                }}
                className="flex w-full flex-col rounded-sm border border-white/5 p-2 text-left transition-all hover:bg-white/5"
              >
                <div className="text-[11px] font-black text-white uppercase">
                  {activeProvider.label}
                </div>
                <div className="text-text-muted text-[9px] font-bold tracking-tight uppercase">
                  DEFAULT_CONFIG
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
                  onClick={() => {
                    onSelect(activeProvider.id, model.value);
                  }}
                  className={`flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left transition-all ${
                    isSelected ? 'bg-white/10 text-white' : 'text-text-muted hover:bg-white/5'
                  }`}
                >
                  <div className="min-w-0">
                    <div
                      className={`truncate text-[11px] font-bold uppercase ${isSelected ? 'text-white' : ''}`}
                    >
                      {model.name}
                    </div>
                    <div className="text-text-muted/40 text-[9px] font-bold tracking-tighter uppercase">
                      {activeProvider.label}
                    </div>
                  </div>
                  {isSelected && <Zap className="h-3 w-3 fill-white text-white" />}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
