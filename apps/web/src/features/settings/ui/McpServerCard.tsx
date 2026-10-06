import { type ReactNode } from 'react';
import { Card, Button, Switch, Select } from '@agentctl/ui';
import { Server, ChevronDown, Edit2, Trash2 } from 'lucide-react';
import type { McpServerData } from '../api/useMcpServers';
import { useMcpTools } from '../api/useMcpServers';
import { formatKeyValuesJson, formatArgumentsJson, approvalPolicyOptions } from './McpUtils';
import { McpToolPermissionEditor } from './McpToolPermissionEditor';

interface McpServerCardProps {
  server: McpServerData;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onToggleEnabled: (checked: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onUpdatePolicy: (policy: string) => void;
  onUpdateToolPermission: (
    toolName: string,
    val: 'always_prompt' | 'auto_approve' | 'deny' | 'inherit',
  ) => void;
}

export function McpServerCard({
  server,
  isExpanded,
  onToggleExpand,
  onToggleEnabled,
  onEdit,
  onDelete,
  onUpdatePolicy,
  onUpdateToolPermission,
}: McpServerCardProps) {
  const { tools: mcpTools } = useMcpTools();
  const serverTools = mcpTools.filter((t) => t.serverId === server.id);

  let parsedArgs: string[] = [];
  try {
    parsedArgs = JSON.parse(server.launchArgs ?? '[]') as string[];
  } catch {
    parsedArgs = [];
  }

  const statusBadge: ReactNode = (() => {
    if (server.status === 'connected') {
      return (
        <span className="rounded border border-emerald-500/30 bg-emerald-500/5 px-1.5 py-0.5 text-[8px] font-black tracking-widest text-emerald-400 uppercase">
          CONNECTED
        </span>
      );
    }
    if (server.status === 'disconnected') {
      return (
        <span className="rounded border border-red-500/30 bg-red-500/5 px-1.5 py-0.5 text-[8px] font-black tracking-widest text-red-400 uppercase">
          DISCONNECTED
        </span>
      );
    }
    return (
      <span className="border-border/40 text-text-muted rounded border px-1.5 py-0.5 text-[8px] font-black tracking-widest uppercase opacity-50">
        DISABLED
      </span>
    );
  })();

  return (
    <Card className="group border-border/20 hover:border-accent/20 overflow-hidden border transition-colors">
      <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-3 p-4">
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={isExpanded}
          aria-controls={`mcp-server-content-${server.id}`}
          className="focus-visible:ring-accent/40 flex min-w-0 flex-1 basis-48 cursor-pointer items-center gap-3.5 rounded-md border-none bg-transparent text-left select-none focus-visible:ring-2 focus-visible:outline-none"
        >
          <div className="border-border/30 bg-surface-secondary/40 group-hover:bg-surface-secondary/60 text-text-main flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border p-1.5 transition-colors">
            <Server className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-role-title text-text-main flex min-w-0 flex-wrap items-center gap-2">
              <span className="min-w-0 [overflow-wrap:anywhere]">{server.name}</span>
              {statusBadge}
            </h3>

            {server.enabled && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {serverTools.slice(0, 3).map((t) => (
                  <span
                    key={t.name}
                    className="bg-surface-secondary/50 text-text-muted border-border/10 max-w-full min-w-0 rounded border px-1.5 py-0.5 font-mono text-[9px] font-extrabold tracking-tight [overflow-wrap:anywhere]"
                  >
                    {t.name.split('__')[1] ?? t.name}
                  </span>
                ))}
                {serverTools.length > 3 && (
                  <span className="text-text-muted text-[9px] font-bold opacity-60">
                    +{serverTools.length - 3} more
                  </span>
                )}
                {serverTools.length === 0 && (
                  <span className="text-text-muted text-[9.5px] italic opacity-40">
                    Discovering tools...
                  </span>
                )}
              </div>
            )}
          </div>
        </button>

        <div className="ml-auto flex shrink-0 items-center gap-3">
          <Switch
            checked={server.enabled}
            onCheckedChange={onToggleEnabled}
            aria-label={`Enable ${server.name}`}
          />
          <button
            type="button"
            onClick={onToggleExpand}
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${server.name}`}
            aria-expanded={isExpanded}
            aria-controls={`mcp-server-content-${server.id}`}
            className="focus-visible:ring-accent/40 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none"
          >
            <ChevronDown
              className={`text-text-muted h-3.5 w-3.5 transition-transform duration-300 ${
                isExpanded ? 'text-text-main rotate-180' : ''
              }`}
            />
          </button>
        </div>
      </div>

      {isExpanded && (
        <div
          id={`mcp-server-content-${server.id}`}
          className="animate-in fade-in slide-in-from-top-1 border-border/10 bg-surface-secondary/5 space-y-4 border-t p-4"
        >
          <div className="border-border/55 bg-surface-secondary/20 flex flex-col gap-3 rounded-lg border p-4 select-none">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1 basis-48">
                <p className="text-role-label text-text-main">Approval policy</p>
                <p className="text-role-caption text-text-muted mt-1 leading-relaxed">
                  Default action for new or unconfigured tools from this server in auto-approve
                  mode.
                </p>
              </div>
              <Select
                value={server.approvalPolicy}
                onChange={onUpdatePolicy}
                options={approvalPolicyOptions}
                className="w-48 max-w-full"
              />
            </div>
          </div>

          <div className="space-y-1">
            <strong className="text-text-muted label-3xs opacity-45">
              {server.type === 'remote' ? 'URL' : 'Command'}
            </strong>
            <pre className="text-text-main bg-surface-secondary/30 border-border/25 overflow-x-auto rounded-md border p-2.5 font-mono text-[10px] whitespace-pre-wrap">
              {server.type === 'remote'
                ? server.url
                : `${server.command ?? ''} ${parsedArgs.join(' ')}`}
            </pre>
          </div>

          <div className="border-border/5 grid gap-4 border-t pt-3.5 text-[11px] sm:grid-cols-2">
            <div className="space-y-1">
              <strong className="text-text-muted label-3xs opacity-45">
                {server.type === 'remote' ? 'Headers' : 'Environment variables'}
              </strong>
              <pre className="text-text-main bg-surface-secondary/30 border-border/25 overflow-x-auto rounded-md border p-2.5 font-mono text-[10px] whitespace-pre-wrap">
                {server.type === 'remote'
                  ? formatKeyValuesJson(server.headers) || 'None'
                  : formatKeyValuesJson(server.launchEnv) || 'None'}
              </pre>
            </div>
            {server.type === 'local' && (
              <div className="space-y-1">
                <strong className="text-text-muted label-3xs opacity-45">Arguments</strong>
                <pre className="text-text-main bg-surface-secondary/30 border-border/25 overflow-x-auto rounded-md border p-2.5 font-mono text-[10px] whitespace-pre-wrap">
                  {formatArgumentsJson(server.launchArgs) || 'None'}
                </pre>
              </div>
            )}
          </div>

          {server.enabled && serverTools.length > 0 && (
            <div className="border-border/5 space-y-3 border-t pt-4">
              <strong className="text-text-muted label-3xs opacity-45">
                Tools & permissions ({serverTools.length})
              </strong>
              <div className="space-y-2">
                {serverTools.map((t) => (
                  <McpToolPermissionEditor
                    key={t.name}
                    toolName={t.name}
                    description={t.description}
                    toolPermissions={server.toolPermissions}
                    onUpdateOverride={onUpdateToolPermission}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="border-border/5 flex flex-wrap items-center justify-end gap-2 border-t pt-3.5">
            <Button
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              className="border-border/20 hover:bg-surface-secondary/40 text-text-muted hover:text-text-main flex h-8 items-center gap-1.5 border px-3 text-xs"
            >
              <Edit2 className="h-3.5 w-3.5" />
              Edit server
            </Button>
            <Button
              variant="ghost"
              onClick={onDelete}
              className="text-text-muted flex h-8 items-center gap-1.5 border border-red-500/20 px-3 text-xs hover:bg-red-500/10 hover:text-rose-400"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete server
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
