import { memo, useEffect, useState } from 'react';
import { Terminal, ChevronRight, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn, Card } from '@agentctl/ui';

interface CommandResultCardProps {
  command: string;
  args?: Record<string, unknown>;
  status?: string;
  isStreaming?: boolean;
}

export const CommandResultCard = memo(function CommandResultCard({
  command,
  args = {},
  status = 'completed',
  isStreaming = false,
}: CommandResultCardProps) {
  const [open, setOpen] = useState(() => isStreaming);

  useEffect(() => {
    if (isStreaming) {
      setOpen(true);
    }
  }, [isStreaming]);

  const argKeys = Object.keys(args);
  const isError = status === 'error' || status === 'failed';
  const isPending = status === 'pending' || isStreaming;

  return (
    <div data-font-ctx="terminal" className="group/command w-full py-1">
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent text-left select-none"
        onClick={() => {
          setOpen(!open);
        }}
      >
        <Card
          status={isError ? 'error' : isPending ? 'pending' : 'default'}
          className="flex-1 flex-row items-center justify-between px-4 py-2.5"
        >
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-lg transition-transform duration-200',
                isError ? 'bg-rose-500/10 text-rose-400' : 'bg-accent/10 text-accent',
                (isStreaming || !isError) && 'group-hover/command:scale-105',
              )}
            >
              <Terminal className="h-3.5 w-3.5" />
            </div>
            <div className="flex min-w-0 flex-col">
              <div className="flex items-center gap-2">
                <span className="text-text-main text-[12px] font-semibold tracking-tight">
                  /{command}
                </span>
                {isError ? (
                  <AlertCircle className="h-3 w-3 text-rose-400" />
                ) : !isPending ? (
                  <CheckCircle2 className="h-3 w-3 text-emerald-400/80" />
                ) : null}
              </div>
              <span className="text-text-muted/50 truncate font-mono text-[10px] tracking-tight">
                {argKeys.length > 0
                  ? argKeys.map((k) => `${k}: ${String(args[k])}`).join(', ')
                  : 'executed'}
              </span>
            </div>
          </div>
          <div className="text-text-muted/40 group-hover/command:text-text-main shrink-0 transition-colors">
            <ChevronRight
              className={cn(
                'h-3 w-3 transition-transform duration-150',
                open && 'rotate-90',
              )}
            />
          </div>
        </Card>
      </button>

      {open && (
        <Card
          status={isError ? 'error' : 'default'}
          className="animate-in fade-in slide-in-from-top-1 hover:border-border/30 mt-2 p-4 duration-200"
        >
          <div className="space-y-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-text-muted text-[10px] font-bold tracking-widest uppercase">
                Arguments
              </span>
              <div className="bg-surface-secondary/60 border-border/30 rounded-lg border p-2.5">
                {argKeys.length > 0 ? (
                  <pre className="text-text-main/90 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap">
                    {JSON.stringify(args, null, 2)}
                  </pre>
                ) : (
                  <span className="text-text-muted text-[11px] italic">No arguments provided</span>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-text-muted text-[10px] font-bold tracking-widest uppercase">
                Status
              </span>
              <div
                className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase',
                  isError
                    ? 'border border-rose-500/20 bg-rose-500/10 text-rose-400'
                    : isPending
                      ? 'bg-accent/10 text-accent border-accent/20 animate-pulse border'
                      : 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-400',
                )}
              >
                {status}
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
});
