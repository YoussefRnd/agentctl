import { useState, memo } from 'react';
import { Terminal, ChevronRight, ChevronDown } from 'lucide-react';
import type { ACPEventToolCallData } from '@agentctl/shared';

export const ToolCallCard = memo(function ToolCallCard({
  tool,
  payload,
}: {
  tool: string;
  payload: ACPEventToolCallData;
}) {
  const [open, setOpen] = useState(false);

  const args = payload.arguments ?? {};
  const argKeys = Object.keys(args).filter((k) => !['toolCallId', 'name'].includes(k));

  return (
    <div className="group relative py-0.5 pr-4 pl-16">
      <div className="bg-text-main/60 ring-background absolute top-1/2 left-10 z-10 h-1 w-1 -translate-x-1/2 -translate-y-1/2 transition-all duration-300 ring-2 group-hover:scale-150 group-hover:bg-text-main" />

      <div
        className="flex cursor-pointer items-center gap-2 select-none"
        onClick={() => {
          setOpen(!open);
        }}
      >
        <div className="bg-surface border-border hover:border-accent/30 hover:bg-surface-secondary/60 flex flex-1 items-center justify-between border px-2 py-1 transition-all duration-200">
          <div className="flex items-center gap-2 overflow-hidden">
            <Terminal className="h-3 w-3 shrink-0 opacity-50" />
            <span className="text-text-main font-bold text-[11px] uppercase tracking-tighter whitespace-nowrap">
              CALL::{tool}
            </span>
            <span className="text-text-muted/30 ml-2 truncate text-[10px] font-bold">
              {argKeys.length > 0 ? `(${argKeys.join(', ')})` : '()'}
            </span>
          </div>
          <div className="shrink-0 pl-2">
            {open ? (
              <ChevronDown className="text-text-muted/40 h-3 w-3" />
            ) : (
              <ChevronRight className="text-text-muted/40 h-3 w-3" />
            )}
          </div>
        </div>
      </div>

      {open && (
        <div className="text-text-muted border-border bg-surface-tertiary mt-1 mb-2 overflow-x-auto border p-2 text-[11px] leading-tight rounded-sm">
          <pre>{JSON.stringify(args, null, 2)}</pre>
        </div>
      )}
    </div>
  );
});

