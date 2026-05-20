import { useState, useMemo, useEffect } from 'react';
import { Search, Bot, Cpu, Zap, LogIn, Loader2 } from 'lucide-react';
import type { DriverDiscovery } from '@agentctl/shared';
import { useDrivers } from '../../../hooks/useDrivers';

interface HarnessPickerProps {
  sessionId: string | null;
  selectedId: string | null;
  selectedModelId?: string | null;
  onSelect: (driverId: string, modelId?: string) => void;
  drivers: DriverDiscovery[];
  isOpen: boolean;
  onClose: () => void;
}

export function HarnessPicker({
  sessionId,
  selectedId,
  selectedModelId,
  onSelect,
  drivers,
  isOpen,
  onClose,
}: HarnessPickerProps) {
  const { login, isLoggingIn } = useDrivers(sessionId);
  const [search, setSearch] = useState('');
  const [internalDriverId, setInternalDriverId] = useState<string | null>(selectedId);

  useEffect(() => {
    if (isOpen) {
      setInternalDriverId(selectedId);
      setSearch('');
    }
  }, [isOpen, selectedId]);

  const activeDriver = useMemo(() => {
    return drivers.find((d) => d.id === internalDriverId) ?? drivers[0];
  }, [drivers, internalDriverId]);

  const models = useMemo(() => {
    const modelOption = activeDriver.configOptions?.find(
      (opt) => opt.id === 'model' || opt.id === 'selectedModel',
    );
    if (!modelOption?.options) return [];

    return modelOption.options.filter(
      (opt) =>
        opt.name.toLowerCase().includes(search.toLowerCase()) ||
        opt.value.toLowerCase().includes(search.toLowerCase()),
    );
  }, [activeDriver, search]);

  if (!isOpen) return null;

  return (
    <div className="bg-surface border-border animate-in fade-in zoom-in-95 slide-in-from-bottom-4 absolute bottom-full left-0 z-50 mb-6 flex w-[560px] overflow-hidden rounded-2xl border shadow-[0_30px_60px_rgba(0,0,0,0.6)] duration-300">
      <div className="bg-background/80 border-border scrollbar-hide flex w-[60px] shrink-0 flex-col items-center gap-3 overflow-y-auto border-r py-4">
        {drivers.map((d) => {
          const isSelected = d.id === internalDriverId;
          const isReady = d.status === 'ready';
          const needsAuth = d.status === 'needs_auth';
          const isEnabled = isReady || needsAuth;

          return (
            <button
              key={d.id}
              onClick={() => {
                setInternalDriverId(d.id);
                setSearch('');
              }}
              disabled={!isEnabled}
              title={d.label + (needsAuth ? ' (Needs Authentication)' : '')}
              className={`relative flex h-11 w-11 items-center justify-center rounded-xl transition-all duration-200 ${
                isSelected
                  ? 'bg-accent/15 text-accent border-accent/30 border shadow-[0_0_15px_rgba(59,130,246,0.2)]'
                  : 'text-text-muted hover:text-text-main hover:bg-surface-hover border border-transparent'
              } ${!isEnabled ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              {d.id.includes('claude') ? <Bot className="h-5 w-5" /> : <Cpu className="h-5 w-5" />}
              {isSelected && (
                <div className="bg-accent absolute top-1/2 left-0 h-5 w-1 -translate-y-1/2 rounded-r-full" />
              )}
              {needsAuth && !isSelected && (
                <div className="absolute top-1 right-1 h-2 w-2 rounded-full bg-yellow-500" />
              )}
            </button>
          );
        })}
      </div>

      <div className="bg-surface flex min-w-0 flex-1 flex-col">
        <div className="border-border/50 bg-background/20 border-b p-4">
          <div className="group relative">
            <Search className="text-text-muted group-focus-within:text-accent absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 transition-colors" />
            <input
              type="text"
              placeholder="Search models..."
              autoFocus
              className="bg-background/50 border-border/50 focus:ring-accent/50 focus:border-accent/50 placeholder:text-text-muted/40 w-full rounded-xl border py-2 pr-4 pl-10 text-[13px] font-medium transition-all focus:ring-1"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
            />
          </div>
        </div>

        <div className="scrollbar-hide h-[360px] space-y-1 overflow-y-auto p-2">
          {activeDriver.status === 'needs_auth' ? (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-yellow-500/10">
                <Bot className="h-8 w-8 text-yellow-500" />
              </div>
              <h3 className="text-text-main mb-2 text-[15px] font-bold">Authentication Required</h3>
              <p className="text-text-muted mb-6 max-w-[280px] text-[13px]">
                {activeDriver.label} needs to be logged in or configured with an API key before it
                can be used.
              </p>

              <div className="flex w-full max-w-[280px] flex-col gap-3">
                {activeDriver.authMethods.length > 0 && (
                  <button
                    onClick={() => {
                      const methodId = activeDriver.authMethods[0].id;
                      if (methodId) login({ driverId: activeDriver.id, methodId });
                      onClose();
                    }}
                    disabled={isLoggingIn}
                    className="bg-accent hover:bg-accent-hover text-background flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-[13px] font-bold shadow-lg transition-all disabled:opacity-50"
                  >
                    {isLoggingIn ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <LogIn className="h-4 w-4" />
                    )}
                    {activeDriver.authMethods[0].name}
                  </button>
                )}

                <div className="text-text-muted mb-1 text-left text-[11px] font-bold tracking-wider uppercase">
                  Manual Configuration
                </div>
                <div className="bg-background/50 border-border rounded-xl border p-3 text-left font-mono text-[12px] break-all select-all">
                  {activeDriver.id.includes('claude')
                    ? 'export ANTHROPIC_API_KEY=...'
                    : 'export GOOGLE_API_KEY=...'}
                </div>
                <p className="text-text-muted mt-1 text-center text-[11px]">
                  Restart the server after setting environment variables.
                </p>
              </div>
            </div>
          ) : models.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center">
              <button
                onClick={() => {
                  onSelect(activeDriver.id);
                }}
                className="hover:bg-surface-hover border-border flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition-all"
              >
                <div className="min-w-0">
                  <div className="text-text-main mb-0.5 text-[13px] font-bold">
                    {activeDriver.label}
                  </div>
                  <div className="text-text-muted truncate text-[11px] font-medium">
                    Default Configuration
                  </div>
                </div>
              </button>
            </div>
          ) : (
            models.map((model, i) => {
              const isSelected = selectedId === activeDriver.id && selectedModelId === model.value;

              return (
                <button
                  key={model.value}
                  onClick={() => {
                    onSelect(activeDriver.id, model.value);
                  }}
                  className={`group flex w-full items-center justify-between rounded-xl px-3 py-3 text-left transition-all ${
                    isSelected
                      ? 'bg-accent/5 border-accent/20 border'
                      : 'hover:bg-surface-hover border border-transparent'
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-4">
                    <div className="min-w-0">
                      <div className="mb-0.5 flex items-center gap-2">
                        <div
                          className={`truncate text-[13px] font-bold transition-colors ${
                            isSelected ? 'text-accent' : 'text-text-main group-hover:text-text-main'
                          }`}
                        >
                          {model.name}
                        </div>
                      </div>
                      <div className="text-text-muted flex items-center gap-1.5 truncate text-[11px] font-medium">
                        <div className="bg-success h-1.5 w-1.5 rounded-full opacity-80" />
                        {activeDriver.label}
                      </div>
                    </div>
                  </div>
                  <div
                    className={`text-text-muted text-[10px] font-bold transition-all duration-300 ${
                      isSelected ? 'hidden' : ''
                    }`}
                  >
                    <span className="bg-surface-hover border-border rounded-md border px-1.5 py-1 shadow-sm">
                      Ctrl+{String(i + 1)}
                    </span>
                  </div>
                  {isSelected && (
                    <div className="bg-accent animate-in zoom-in ml-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full shadow-lg duration-300">
                      <Zap className="text-background h-3 w-3 fill-current" />
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
