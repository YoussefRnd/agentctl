import { useState, useMemo } from 'react';
import { Search, Star, Bot, Cpu, Zap, Command, Sparkles } from 'lucide-react';
import type { DriverDiscovery } from '@agentctl/shared';

interface HarnessPickerProps {
  selectedId: string | null;
  onSelect: (driverId: string, model?: string) => void;
  drivers: DriverDiscovery[];
  isOpen: boolean;
  onClose: () => void;
}

export function HarnessPicker({ selectedId, onSelect, drivers, isOpen }: HarnessPickerProps) {
  const [search, setSearch] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<'all' | 'installed' | 'favorites'>('all');

  const filteredDrivers = useMemo(() => {
    const base = drivers.filter((d) => 
      d.label.toLowerCase().includes(search.toLowerCase()) ||
      d.id.toLowerCase().includes(search.toLowerCase())
    );

    if (selectedGroup === 'installed') {
      return base.filter((d) => d.status === 'ready');
    }

    return base;
  }, [drivers, search]);

  if (!isOpen) return null;

  return (
    <div className="absolute bottom-full left-0 mb-6 w-[520px] bg-surface border border-border rounded-2xl shadow-[0_30px_60px_rgba(0,0,0,0.6)] overflow-hidden flex animate-in fade-in zoom-in-95 slide-in-from-bottom-4 duration-300 z-50">
      {/* Left Icon Strip */}
      <div className="w-14 bg-background/50 border-r border-border flex flex-col items-center py-5 gap-5">
        <button 
          onClick={() => {
            setSelectedGroup('all');
          }}
          className={`p-2 rounded-xl transition-all duration-200 ${selectedGroup === 'all' ? 'text-accent bg-accent/10 shadow-[0_0_15px_rgba(59,130,246,0.2)]' : 'text-text-muted hover:text-text-main'}`}
        >
          <Star className="w-5 h-5" />
        </button>
        <div className="w-6 h-px bg-border/50" />
        <button 
          onClick={() => {
            setSelectedGroup('installed');
          }}
          className={`p-2 rounded-xl transition-all duration-200 ${selectedGroup === 'installed' ? 'text-accent bg-accent/10 shadow-[0_0_15px_rgba(59,130,246,0.2)]' : 'text-text-muted hover:text-text-main'}`}
        >
          <Bot className="w-5 h-5" />
        </button>
        <button 
          onClick={() => {
            setSelectedGroup('favorites');
          }}
          className={`p-2 rounded-xl transition-all duration-200 ${selectedGroup === 'favorites' ? 'text-accent bg-accent/10 shadow-[0_0_15px_rgba(59,130,246,0.2)]' : 'text-text-muted hover:text-text-main'}`}
        >
          <Cpu className="w-5 h-5" />
        </button>
      </div>
      
      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 bg-surface">
        <div className="p-4 border-b border-border/50 bg-background/20">
          <div className="relative group">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted group-focus-within:text-accent transition-colors" />
            <input 
              type="text" 
              placeholder="Search harnesses and models..." 
              autoFocus
              className="w-full bg-background/50 border border-border/50 rounded-xl pl-10 pr-4 py-2.5 text-[13px] font-medium focus:ring-1 focus:ring-accent/50 focus:border-accent/50 transition-all placeholder:text-text-muted/40"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-40 group-focus-within:opacity-20 transition-opacity">
              <Command className="w-3 h-3" />
              <span className="text-[10px] font-bold">F</span>
            </div>
          </div>
        </div>
        
        <div className="h-[360px] overflow-y-auto p-2 space-y-1 scrollbar-hide">
          {filteredDrivers.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8">
              <div className="w-12 h-12 bg-surface-hover rounded-2xl flex items-center justify-center mb-4 border border-border">
                <Search className="w-5 h-5 text-text-muted" />
              </div>
              <p className="text-[13px] font-bold text-text-main">No harnesses found</p>
              <p className="text-[12px] text-text-muted mt-1">Try a different search term or check installation.</p>
            </div>
          ) : (
            filteredDrivers.map((d, i) => {
              const isSelected = selectedId === d.id;
              const isReady = d.status === 'ready';
              
              return (
                <button 
                  key={d.id}
                  onClick={() => {
                    onSelect(d.id);
                  }}
                  disabled={!isReady}
                  className={`w-full flex items-center justify-between px-3 py-3 rounded-xl group transition-all text-left ${isSelected ? 'bg-accent/5 border border-accent/20' : 'hover:bg-surface-hover'}`}
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${isSelected ? 'bg-accent text-background' : 'bg-background/80 group-hover:bg-accent/10 group-hover:text-accent text-text-muted'}`}>
                      {d.id.includes('claude') ? <Bot className="w-5 h-5" /> : <Cpu className="w-5 h-5" />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <div className={`text-[13px] font-bold transition-colors ${isSelected ? 'text-accent' : 'text-text-main'}`}>
                          {d.label}
                        </div>
                        {isReady && !isSelected && <div className="w-1.5 h-1.5 bg-success rounded-full shadow-[0_0_8px_rgba(16,185,129,0.4)]" />}
                        {!isReady && <div className="w-1.5 h-1.5 bg-danger rounded-full shadow-[0_0_8px_rgba(239,68,68,0.4)]" />}
                      </div>
                      <div className="text-[11px] text-text-muted font-medium truncate max-w-[280px]">
                        {d.description ?? 'Standard Agent Client Protocol Harness'}
                      </div>
                    </div>
                  </div>
                  <div className={`text-[10px] font-bold text-text-muted transition-all duration-300 translate-x-2 opacity-0 group-hover:opacity-100 group-hover:translate-x-0 ${isSelected ? 'hidden' : ''}`}>
                    <span className="bg-surface-hover px-1.5 py-1 rounded-md border border-border">Ctrl+{String(i + 1)}</span>
                  </div>
                  {isSelected && (
                    <div className="w-5 h-5 bg-accent rounded-full flex items-center justify-center shadow-lg animate-in zoom-in duration-300">
                      <Zap className="w-3 h-3 text-background fill-current" />
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>

        <div className="px-4 py-3 bg-background/30 border-t border-border/50 flex items-center justify-between text-[10px] text-text-muted font-bold tracking-widest uppercase">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-2">
              <kbd className="bg-surface px-1.5 py-0.5 rounded border border-border text-[9px]">ESC</kbd> CLOSE
            </span>
            <span className="flex items-center gap-2">
              <kbd className="bg-surface px-1.5 py-0.5 rounded border border-border text-[9px]">TAB</kbd> NAVIGATE
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-accent/80">
            <Sparkles className="w-3 h-3" />
            <span>{filteredDrivers.length} AGENTS READY</span>
          </div>
        </div>
      </div>
    </div>
  );
}
