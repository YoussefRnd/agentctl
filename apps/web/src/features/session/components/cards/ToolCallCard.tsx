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
    <div className="group relative py-1 pr-6 pl-14">
      <div className="bg-accent/40 border-accent/80 ring-background absolute top-1/2 left-8 z-10 h-1.5 w-1.5 -translate-x-[2.5px] -translate-y-1/2 rounded-full border ring-4 transition-transform duration-300 group-hover:scale-150" />

      <div
        className="flex cursor-pointer items-center gap-3 select-none"
        onClick={() => {
          setOpen(!open);
        }}
      >
        <div className="flex flex-1 items-center justify-between rounded-md border border-white/10 bg-white/[0.02] px-3 py-1.5 backdrop-blur-xl transition-all duration-200 hover:border-white/20 hover:bg-white/[0.04]">
          <div className="flex items-center gap-3 overflow-hidden">
            <Terminal className="text-accent/80 h-3.5 w-3.5 shrink-0" />
            <span className="text-text-main/90 font-mono text-[13px] font-medium whitespace-nowrap">
              {tool}
            </span>
            <span className="text-text-muted/40 ml-2 truncate font-mono text-[12px]">
              {argKeys.length > 0 ? `{ ${argKeys.join(', ')} }` : ''}
            </span>
          </div>
          <div className="shrink-0 pl-3">
            {open ? (
              <ChevronDown className="text-text-muted/60 h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="text-text-muted/60 h-3.5 w-3.5" />
            )}
          </div>
        </div>
      </div>

      {open && (
        <div className="text-text-muted/80 selection:bg-accent/20 mt-2 mb-3 overflow-x-auto rounded-md border border-white/10 bg-black/40 p-3 font-mono text-[12px] backdrop-blur-xl">
          <pre className="leading-relaxed">{JSON.stringify(args, null, 2)}</pre>
        </div>
      )}
    </div>
  );
});
