import { useMcpServers, type McpServerData } from '@/features/settings';

export interface McpStatusPanelProps {
  servers?: McpServerData[];
  isLoading?: boolean;
}

export function McpStatusPanel({
  servers: customServers,
  isLoading: customIsLoading,
}: McpStatusPanelProps = {}) {
  const { mcpServers: hookServers, isLoading: hookIsLoading } = useMcpServers();

  const mcpServers = customServers ?? hookServers;
  const isLoading = customIsLoading ?? hookIsLoading;

  if (isLoading) {
    return (
      <div className="text-text-muted flex items-center justify-center py-4 text-xs font-normal">
        Loading MCP servers...
      </div>
    );
  }

  if (mcpServers.length === 0) {
    return (
      <div className="border-border/20 flex flex-col items-center justify-center rounded-lg border border-dashed px-4 py-6 text-center">
        <p className="text-text-muted text-xs font-normal">No MCP servers configured</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 select-none">
      {mcpServers.map((server) => {
        const errorText = server.error;
        let indicator = (
          <div className="bg-surface-tertiary/40 text-text-muted/50 ring-border/20 flex h-5 w-5 items-center justify-center rounded-full ring-1">
            <span className="bg-text-muted/40 h-1.5 w-1.5 rounded-full" />
          </div>
        );
        let statusLabel = 'Disabled';
        let statusClass = 'text-text-muted/70';

        if (server.enabled) {
          if (server.status === 'connected') {
            indicator = (
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              </div>
            );
            statusLabel = 'Connected';
            statusClass = 'text-emerald-400/90 font-medium';
          } else {
            indicator = (
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/20">
                <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
              </div>
            );
            statusLabel = errorText ?? 'Disconnected';
            statusClass = 'text-rose-400/90 font-medium';
          }
        }

        return (
          <div
            key={server.id}
            className="border-border/10 bg-surface-secondary/10 hover:bg-surface-secondary/20 flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors"
          >
            <div className="shrink-0">{indicator}</div>
            <div className="flex min-w-0 flex-1 items-baseline justify-between gap-2">
              <span className="text-text-main truncate font-mono text-xs font-medium">
                {server.name}
              </span>
              <span className={`truncate font-mono text-xs ${statusClass}`}>{statusLabel}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
