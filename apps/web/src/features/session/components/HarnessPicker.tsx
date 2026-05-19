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
    if (!modelOption) return [];

    return modelOption.options.filter(
      (opt) =>
        opt.name.toLowerCase().includes(search.toLowerCase()) ||
        opt.value.toLowerCase().includes(search.toLowerCase()),
    );
  }, [activeDriver, search]);

  if (!isOpen) return null;

  return (
    <div className="absolute bottom-full left-0 mb-6 w-[560px] bg-surface border border-border rounded-2xl shadow-[0_30px_60px_rgba(0,0,0,0.6)] overflow-hidden flex animate-in fade-in zoom-in-95 slide-in-from-bottom-4 duration-300 z-50">
      <div className="w-[60px] bg-background/80 border-r border-border flex flex-col items-center py-4 gap-3 shrink-0 overflow-y-auto scrollbar-hide">
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
              className={`relative w-11 h-11 flex items-center justify-center rounded-xl transition-all duration-200 ${
                isSelected
                  ? 'bg-accent/15 text-accent shadow-[0_0_15px_rgba(59,130,246,0.2)] border border-accent/30'
                  : 'text-text-muted hover:text-text-main hover:bg-surface-hover border border-transparent'
              } ${!isEnabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {d.id.includes('claude') ? <Bot className="w-5 h-5" /> : <Cpu className="w-5 h-5" />}
              {isSelected && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-accent rounded-r-full" />
              )}
              {needsAuth && !isSelected && (
                <div className="absolute top-1 right-1 w-2 h-2 bg-yellow-500 rounded-full" />
              )}
            </button>
          );
        })}
      </div>

      <div className="flex-1 flex flex-col min-w-0 bg-surface">
        <div className="p-4 border-b border-border/50 bg-background/20">
          <div className="relative group">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted group-focus-within:text-accent transition-colors" />
            <input
              type="text"
              placeholder="Search models..."
              autoFocus
              className="w-full bg-background/50 border border-border/50 rounded-xl pl-10 pr-4 py-2 text-[13px] font-medium focus:ring-1 focus:ring-accent/50 focus:border-accent/50 transition-all placeholder:text-text-muted/40"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
            />
          </div>
        </div>

        <div className="h-[360px] overflow-y-auto p-2 space-y-1 scrollbar-hide">
          {activeDriver.status === 'needs_auth' ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8">
              <div className="w-16 h-16 bg-yellow-500/10 rounded-full flex items-center justify-center mb-4">
                <Bot className="w-8 h-8 text-yellow-500" />
              </div>
              <h3 className="text-[15px] font-bold text-text-main mb-2">Authentication Required</h3>
              <p className="text-[13px] text-text-muted mb-6 max-w-[280px]">
                {activeDriver.label} needs to be logged in or configured with an API key before it
                can be used.
              </p>

              <div className="flex flex-col gap-3 w-full max-w-[280px]">
                {activeDriver.authMethods.length > 0 && (
                  <button
                    onClick={() => {
                      const methodId = activeDriver.authMethods[0].id;
                      if (methodId) login({ driverId: activeDriver.id, methodId });
                      onClose();
                    }}
                    disabled={isLoggingIn}
                    className="flex items-center justify-center gap-2 w-full py-2.5 bg-accent hover:bg-accent-hover text-background rounded-xl text-[13px] font-bold transition-all shadow-lg disabled:opacity-50"
                  >
                    {isLoggingIn ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <LogIn className="w-4 h-4" />
                    )}
                    {activeDriver.authMethods[0].name}
                  </button>
                )}

                <div className="text-[11px] text-text-muted text-left mb-1 uppercase tracking-wider font-bold">
                  Manual Configuration
                </div>
                <div className="p-3 bg-background/50 border border-border rounded-xl text-[12px] font-mono text-left break-all select-all">
                  {activeDriver.id.includes('claude')
                    ? 'export ANTHROPIC_API_KEY=...'
                    : 'export GOOGLE_API_KEY=...'}
                </div>
                <p className="text-[11px] text-text-muted mt-1 text-center">
                  Restart the server after setting environment variables.
                </p>
              </div>
            </div>
          ) : models.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8">
              <button
                onClick={() => {
                  onSelect(activeDriver.id);
                }}
                className="w-full flex items-center justify-between px-4 py-3 rounded-xl hover:bg-surface-hover transition-all text-left border border-border"
              >
                <div className="min-w-0">
                  <div className="text-[13px] font-bold text-text-main mb-0.5">
                    {activeDriver.label}
                  </div>
                  <div className="text-[11px] text-text-muted font-medium truncate">
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
                  className={`w-full flex items-center justify-between px-3 py-3 rounded-xl group transition-all text-left ${
                    isSelected
                      ? 'bg-accent/5 border border-accent/20'
                      : 'hover:bg-surface-hover border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <div
                          className={`text-[13px] font-bold transition-colors truncate ${
                            isSelected ? 'text-accent' : 'text-text-main group-hover:text-text-main'
                          }`}
                        >
                          {model.name}
                        </div>
                      </div>
                      <div className="text-[11px] text-text-muted font-medium flex items-center gap-1.5 truncate">
                        <div className="w-1.5 h-1.5 bg-success rounded-full opacity-80" />
                        {activeDriver.label}
                      </div>
                    </div>
                  </div>
                  <div
                    className={`text-[10px] font-bold text-text-muted transition-all duration-300 ${
                      isSelected ? 'hidden' : ''
                    }`}
                  >
                    <span className="bg-surface-hover px-1.5 py-1 rounded-md border border-border shadow-sm">
                      Ctrl+{String(i + 1)}
                    </span>
                  </div>
                  {isSelected && (
                    <div className="w-5 h-5 bg-accent rounded-full flex items-center justify-center shadow-lg animate-in zoom-in duration-300 shrink-0 ml-2">
                      <Zap className="w-3 h-3 text-background fill-current" />
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
