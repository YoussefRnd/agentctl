import { useState } from 'react';
import { useMcpServers } from '../../../hooks/useMcpServers';

export function McpStatusPanel() {
  const { mcpServers, isLoading } = useMcpServers();
  const [isOpen, setIsOpen] = useState(true);

  if (isLoading || mcpServers.length === 0) return null;

  return (
    <section className="mt-8">
      <button
        type="button"
        onClick={() => {
          setIsOpen(!isOpen);
        }}
        aria-expanded={isOpen}
        className="text-text-muted/30 hover:text-text-main mb-5 flex w-full cursor-pointer items-center justify-between border-none bg-transparent p-0 text-[10px] font-black tracking-[0.3em] uppercase transition-colors"
      >
        <span>MCP</span>
        <span className="text-[8px] select-none">{isOpen ? '▼' : '▶'}</span>
      </button>

      {isOpen && (
        <div className="space-y-3 pl-1 select-none">
          {mcpServers.map((server) => {
            const errorText = server.error;
            let indicator = (
              <div className="bg-surface-tertiary/30 text-text-muted/20 ring-border/10 flex h-5 w-5 items-center justify-center rounded-full ring-1">
                <span className="bg-text-muted/20 h-1.5 w-1.5 rounded-full" />
              </div>
            );
            let statusLabel = 'Disabled';

            if (server.enabled) {
              if (server.status === 'connected') {
                indicator = (
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                  </div>
                );
                statusLabel = 'Connected';
              } else {
                indicator = (
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/20">
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
                  </div>
                );
                statusLabel = errorText ?? 'Disconnected';
              }
            }

            return (
              <div key={server.id} className="flex items-center gap-3.5 px-1 py-0.5">
                <div className="shrink-0">{indicator}</div>
                <div className="flex min-w-0 flex-1 items-baseline gap-2">
                  <span className="text-text-main font-mono text-[11px] font-bold tracking-tight">
                    {server.name}
                  </span>
                  <span className="text-text-muted/40 truncate font-mono text-[9px] font-normal italic">
                    {statusLabel}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
