import { useState, useMemo, useEffect } from 'react';
import { Search, Bot, Cpu, Zap } from 'lucide-react';
import type { DriverDiscovery } from '@agentctl/shared';

interface HarnessPickerProps {
  selectedId: string | null;
  selectedModelId?: string | null;
  onSelect: (driverId: string, modelId?: string) => void;
  drivers: DriverDiscovery[];
  isOpen: boolean;
  onClose: () => void;
}

export function HarnessPicker({ selectedId, selectedModelId, onSelect, drivers, isOpen, _onClose }: HarnessPickerProps & { _onClose?: () => void }) {
  const [search, setSearch] = useState('');
  const [internalDriverId, setInternalDriverId] = useState<string | null>(selectedId);

  useEffect(() => {
    if (isOpen) {
      setInternalDriverId(selectedId);
      setSearch(''); // Reset search on open
    }
  }, [isOpen, selectedId]);

  const activeDriver = useMemo(() => {
    return drivers.find((d) => d.id === internalDriverId) ?? drivers[0];
  }, [drivers, internalDriverId]);

  const models = useMemo(() => {
    const modelOption = activeDriver.configOptions?.find(
      (opt) => opt.id === 'model' || opt.id === 'selectedModel',
    );
    // modelOption.options is always an array based on schema, so we just check if modelOption exists
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
      {/* Left Column: Agents */}
      <div className="w-[60px] bg-background/80 border-r border-border flex flex-col items-center py-4 gap-3 shrink-0 overflow-y-auto scrollbar-hide">
        {drivers.map((d) => {
          const isSelected = d.id === internalDriverId;
          const isReady = d.status === 'ready';
          
          return (
            <button
              key={d.id}
              onClick={() => {
                setInternalDriverId(d.id);
                setSearch('');
              }}
              disabled={!isReady}
              title={d.label}
              className={`relative w-11 h-11 flex items-center justify-center rounded-xl transition-all duration-200 ${
                isSelected
                  ? 'bg-accent/15 text-accent shadow-[0_0_15px_rgba(59,130,246,0.2)] border border-accent/30'
                  : 'text-text-muted hover:text-text-main hover:bg-surface-hover border border-transparent'
              } ${!isReady ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {d.id.includes('claude') ? <Bot className="w-5 h-5" /> : <Cpu className="w-5 h-5" />}
              {isSelected && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-accent rounded-r-full" />
              )}
            </button>
          );
        })}
      </div>

      {/* Right Column: Models */}
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
          {models.length === 0 ? (
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
                    isSelected ? 'bg-accent/5 border border-accent/20' : 'hover:bg-surface-hover border border-transparent'
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
