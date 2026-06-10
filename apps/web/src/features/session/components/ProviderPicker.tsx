import { useState, useMemo, useEffect, useRef } from 'react';
import { Search, Bot, Cpu, Zap, RefreshCw } from 'lucide-react';
import type { ProviderDiscovery } from '@agentctl/shared';
import { PROVIDER_ENV_KEYS, validateApiKey } from '@agentctl/shared';
import { useProviders } from '../../../hooks/useProviders';
import { toast } from 'sonner';


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
              toast.success('Provider selection updated successfully.');
              if (activeProvider.status !== 'ready' && activeProvider.status !== 'needs_auth') {
                activate(activeProvider.id, {
                  onSuccess: () => {
                    toast.success('Agent activated successfully!');
                    onSelect(activeProvider.id);
                  },
                  onError: (err) => {
                    toast.error(`Activation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
                  },
                });
              } else {
                onSelect(activeProvider.id);
              }
            },
            onError: (err) => {
              toast.error(`Toggle failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
            },
          },
        );
      } else if (activeProvider.status !== 'ready' && activeProvider.status !== 'needs_auth') {
        activate(activeProvider.id, {
          onSuccess: () => {
            toast.success('Agent activated successfully!');
            onSelect(activeProvider.id);
          },
          onError: (err) => {
            toast.error(`Activation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
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
            toast.success('Provider configuration updated.');
            proceedWithEnable();
          },
          onError: (err) => {
            toast.error(`Update failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
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
      className="animate-in fade-in zoom-in-95 slide-in-from-bottom-2 absolute bottom-full left-0 z-50 mb-2 flex w-[480px] overflow-hidden border border-border/40 bg-surface-secondary/95 text-text-main shadow-xl shadow-black/40 backdrop-blur-md rounded-xl"
    >
      <div className="flex w-12 shrink-0 flex-col items-center gap-2 border-r border-border/20 bg-black/10 py-2">
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
              className={`relative flex h-8 w-8 items-center justify-center rounded-lg transition-all ${
                isSelected
                  ? 'bg-accent text-brand-crust'
                  : 'text-text-muted hover:bg-text-main/5 hover:text-text-main'
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

      <div className="flex min-w-0 flex-1 flex-col bg-transparent">
        <div className="flex items-center gap-2 border-b border-border/20 p-2">
          <div className="relative flex-1">
            <Search className="text-text-muted absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filter models..."
              autoFocus
              className="h-8 w-full rounded-lg border border-border/30 bg-surface/40 pl-9 pr-3 font-sans text-xs text-text-main placeholder:text-text-muted/30 focus:border-accent/40 focus:ring-1 focus:ring-accent/40 outline-none transition-all duration-200"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
            />
          </div>
          <button
            onClick={() => {
              refreshProvider(activeProvider.id, {
                onError: (err) => {
                  toast.error(`Refresh failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
                },
              });
            }}
            disabled={isRefreshing}
            className="text-text-muted p-1.5 transition-colors hover:text-text-main hover:bg-text-main/5 rounded-lg disabled:opacity-30"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="h-[280px] space-y-1 overflow-y-auto p-1.5">
          {activeProvider.status === 'needs_auth' || !activeProvider.enabled ? (
            <div className="flex h-full flex-col items-center justify-center p-4 text-center">
              <h3 className="mb-1 text-[11px] font-black text-text-main uppercase tracking-wider">
                {!activeProvider.enabled ? 'Setup Required' : 'Authentication Required'}
              </h3>
              <p className="text-text-muted mb-4 max-w-[240px] text-[10px] font-bold tracking-tight uppercase">
                Configure and enable {activeProvider.label}.
              </p>

              <div className="flex w-full max-w-[240px] flex-col gap-3 text-left">
                {envKeys.map((key) => {
                  const errorMsg = validateApiKey(key, keysValues[key] || '');
                  return (
                    <div key={key} className="space-y-1.5">
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
                        className={`h-8 w-full rounded-lg border border-border/30 bg-surface/40 px-2.5 font-sans text-xs text-text-main placeholder:text-text-muted/30 focus:border-accent/40 focus:ring-1 focus:ring-accent/40 outline-none transition-all duration-200 ${errorMsg ? 'border-danger/40 focus:border-danger/60 focus:ring-danger/40' : ''}`}
                      />
                    </div>
                  );
                })}

                {activeProvider.authMethods.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    <span className="text-text-muted text-[9px] font-black tracking-widest uppercase">
                      Auth Methods
                    </span>
                    {activeProvider.authMethods.map((method) => (
                      <button
                        key={method.id}
                        type="button"
                        onClick={() => {
                          login(
                            { providerId: activeProvider.id, methodId: method.id },
                            {
                              onSuccess: () => {
                                toast.success('Login initiated. Please check your browser or terminal.');
                              },
                              onError: (err) => {
                                toast.error(`Login failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
                              },
                            }
                          );
                        }}
                        disabled={isPending}
                        className="w-full border border-border/30 bg-surface-secondary/30 rounded-lg py-1.5 text-center text-[10px] font-bold tracking-wider uppercase text-text-main transition-all hover:bg-text-main/5 hover:border-border/50 disabled:opacity-30"
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
                  className="mt-2 w-full bg-accent text-brand-crust rounded-lg py-1.5 text-center text-[10px] font-bold tracking-wider uppercase hover:opacity-90 transition-all active:scale-[0.98] disabled:opacity-30"
                >
                  {isPending ? 'CONNECTING...' : 'SAVE AND CONNECT'}
                </button>
              </div>
            </div>
          ) : models.length === 0 ? (
            <div className="p-2">
              <button
                onClick={() => {
                  onSelect(activeProvider.id);
                }}
                className="flex w-full flex-col rounded-lg border border-border/20 p-3 text-left transition-all hover:bg-text-main/5"
              >
                <div className="text-[11px] font-black text-text-main uppercase tracking-wider">
                  {activeProvider.label}
                </div>
                <div className="text-text-muted text-[9px] font-bold tracking-tight uppercase">
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
                  onClick={() => {
                    onSelect(activeProvider.id, model.value);
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-all ${
                    isSelected ? 'bg-accent/15 text-accent' : 'text-text-muted hover:bg-text-main/5 hover:text-text-main'
                  }`}
                >
                  <div className="min-w-0">
                    <div
                      className={`truncate text-[11px] font-bold uppercase tracking-wider ${isSelected ? 'text-accent' : 'text-text-main'}`}
                    >
                      {model.name}
                    </div>
                    <div className="text-text-muted/50 text-[9px] font-semibold tracking-tighter uppercase">
                      {activeProvider.label}
                    </div>
                  </div>
                  {isSelected && <Zap className="h-3 w-3 fill-accent text-accent" />}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
