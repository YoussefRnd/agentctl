import { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';

export function ToolCallCard({ tool, payload }: { tool: string, payload: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-2 border border-border rounded-lg bg-surface overflow-hidden">
      <div 
        className="px-4 py-2 flex items-center cursor-pointer hover:bg-border/50 text-sm font-mono"
        onClick={() => { setOpen(!open); }}
      >
        {open ? <ChevronDown className="w-4 h-4 mr-2" /> : <ChevronRight className="w-4 h-4 mr-2" />}
        <span className="text-accent">{tool}</span>
      </div>
      {open && (
        <div className="p-4 border-t border-border bg-background text-xs font-mono overflow-x-auto">
          <pre>{JSON.stringify(payload, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
