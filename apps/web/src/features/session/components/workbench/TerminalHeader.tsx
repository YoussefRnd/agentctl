import { RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@agentctl/ui';

interface TerminalHeaderProps {
  status: 'connecting' | 'connected' | 'disconnected';
  shellName: string;
  reconnect: () => void;
  handleRestart: () => void;
  handleClear: () => void;
}

export function TerminalHeader({
  status,
  shellName,
  reconnect,
  handleRestart,
  handleClear,
}: TerminalHeaderProps) {
  return (
    <div className="border-border/20 bg-surface-secondary/15 flex h-8 shrink-0 items-center justify-between border-b px-2.5 text-xs">
      {/* Left: Shell Badge + Subtle Dot */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5">
          <span
            className={`h-1.5 w-1.5 rounded-full transition-colors duration-300 ${
              status === 'connected'
                ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]'
                : status === 'connecting'
                  ? 'animate-pulse bg-amber-400'
                  : 'bg-rose-500'
            }`}
            title={
              status === 'connected'
                ? 'Connected'
                : status === 'connecting'
                  ? 'Connecting...'
                  : 'Disconnected'
            }
          />
          <span className="text-text-muted/80 font-mono text-[11px] font-medium tracking-tight">
            {shellName}
          </span>
        </div>

        {status === 'disconnected' && (
          <span className="text-[10px] font-medium text-rose-400 opacity-80">(Disconnected)</span>
        )}
      </div>

      {/* Right: Minimal Icon Actions */}
      <div className="flex items-center gap-1">
        {status === 'disconnected' && (
          <Button
            variant="outline"
            size="sm"
            onClick={reconnect}
            className="!h-5 !px-2 text-[10px]"
          >
            Reconnect
          </Button>
        )}
        <button
          type="button"
          onClick={handleRestart}
          title="Restart shell process"
          className="text-text-muted/60 hover:text-text-main hover:bg-surface-tertiary/30 flex h-5.5 w-5.5 items-center justify-center rounded transition-colors"
          aria-label="Restart shell"
        >
          <RotateCcw className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={handleClear}
          title="Clear scrollback"
          className="text-text-muted/60 hover:text-text-main hover:bg-surface-tertiary/30 flex h-5.5 w-5.5 items-center justify-center rounded transition-colors"
          aria-label="Clear terminal"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
