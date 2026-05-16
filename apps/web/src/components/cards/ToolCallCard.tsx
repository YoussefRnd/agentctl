import { useState } from 'react';
import { Terminal, ChevronRight, ChevronDown } from 'lucide-react';

export function ToolCallCard({ tool, payload }: { tool: string, payload: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative pl-14 pr-6 py-1 group">
      {/* Causality Node (Dot) */}
      <div className="absolute left-8 top-1/2 -translate-y-1/2 -translate-x-[2.5px] w-1.5 h-1.5 rounded-full bg-accent/40 border border-accent/80 ring-4 ring-background z-10 transition-transform duration-300 group-hover:scale-150" />

      {/* Sleek single line command header */}
      <div 
        className="flex items-center gap-3 cursor-pointer select-none"
        onClick={() => { setOpen(!open); }}
      >
        <div className="flex-1 flex items-center justify-between px-3 py-1.5 rounded-md backdrop-blur-xl bg-white/[0.02] hover:bg-white/[0.04] border border-white/10 hover:border-white/20 transition-all duration-200">
          <div className="flex items-center gap-3 overflow-hidden">
            <Terminal className="w-3.5 h-3.5 text-accent/80 shrink-0" />
            <span className="text-[13px] font-mono font-medium text-text-main/90 whitespace-nowrap">
              {tool}
            </span>
            <span className="text-[12px] font-mono text-text-muted/40 truncate ml-2">
               {payload && typeof payload === 'object' && Object.keys(payload).length > 0 
                 ? `{ ${Object.keys(payload).join(', ')} }`
                 : ''}
            </span>
          </div>
          <div className="shrink-0 pl-3">
            {open ? <ChevronDown className="w-3.5 h-3.5 text-text-muted/60" /> : <ChevronRight className="w-3.5 h-3.5 text-text-muted/60" />}
          </div>
        </div>
      </div>
      
      {open && (
        <div className="mt-2 mb-3 p-3 rounded-md border border-white/10 bg-black/40 backdrop-blur-xl text-[12px] font-mono text-text-muted/80 overflow-x-auto selection:bg-accent/20">
          <pre className="leading-relaxed">{JSON.stringify(payload, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
