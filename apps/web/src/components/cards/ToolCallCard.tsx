import { useState } from 'react';
import { ChevronRight, ChevronDown, Terminal } from 'lucide-react';

export function ToolCallCard({ tool, payload }: { tool: string, payload: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mx-6 my-4 border border-border rounded-xl bg-surface/50 overflow-hidden transition-all duration-200 hover:border-border/80 shadow-sm">
      <div 
        className="px-4 py-2.5 flex items-center justify-between cursor-pointer hover:bg-surface-hover transition-colors"
        onClick={() => { setOpen(!open); }}
      >
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-accent/10 rounded-lg">
            <Terminal className="w-3.5 h-3.5 text-accent" />
          </div>
          <span className="text-[13px] font-mono font-medium text-text-main">{tool}</span>
        </div>
        {open ? <ChevronDown className="w-4 h-4 text-text-muted" /> : <ChevronRight className="w-4 h-4 text-text-muted" />}
      </div>
      {open && (
        <div className="p-4 border-t border-border bg-background/50 text-[12px] font-mono text-text-muted overflow-x-auto selection:bg-accent/20">
          <pre className="leading-relaxed">{JSON.stringify(payload, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
