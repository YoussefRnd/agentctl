import { useState } from 'react';
import { useMcpServers } from '../../../hooks/useMcpServers';
import { Card, Button } from '@agentctl/ui';
import { Cpu, Plus } from 'lucide-react';
import { toast } from 'sonner';
import {
  parseArgumentsText,
  parseKeyValuesText,
  formatKeyValuesJson,
  formatArgumentsJson,
  initialFormState,
  updateToolOverride,
  type McpFormState,
} from './McpUtils';
import { McpServerForm } from './McpServerForm';
import { McpServerCard } from './McpServerCard';
import type { McpServerData } from '../../../hooks/useMcpServers';

export function McpSettings() {
  const { mcpServers, isLoading, addMcpServer, updateMcpServer, deleteMcpServer } = useMcpServers();
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedServers, setExpandedServers] = useState<Record<string, boolean>>({});
  const [formState, setFormState] = useState<McpFormState>(initialFormState);

  const toggleServerExpanded = (id: string) => {
    setExpandedServers((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleResetForm = () => {
    setFormState(initialFormState);
    setIsAddingNew(false);
    setEditingId(null);
  };

  const buildServerPayload = (): Partial<McpServerData> => ({
    name: formState.name.trim(),
    type: formState.type,
    command: formState.type === 'local' ? formState.command.trim() : null,
    launchArgs: formState.type === 'local' ? parseArgumentsText(formState.args) : '[]',
    launchEnv: formState.type === 'local' ? parseKeyValuesText(formState.env) : '{}',
    url: formState.type === 'remote' ? formState.url.trim() : null,
    headers: formState.type === 'remote' ? parseKeyValuesText(formState.headers) : '{}',
    approvalPolicy: formState.approvalPolicy,
  });

  const validate = (): boolean => {
    if (!formState.name) {
      toast.error('Name is required.');
      return false;
    }
    if (formState.type === 'local' && !formState.command) {
      toast.error('Command is required for local servers.');
      return false;
    }
    if (formState.type === 'remote' && !formState.url) {
      toast.error('URL is required for remote servers.');
      return false;
    }
    return true;
  };

  const handleSaveNew = () => {
    if (!validate()) return;
    const generatedId = formState.name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/[\s_-]+/g, '-');
    addMcpServer({ id: generatedId, ...buildServerPayload(), enabled: true, autoApprove: false });
    handleResetForm();
  };

  const handleSaveEdit = (id: string) => {
    if (!validate()) return;
    updateMcpServer({ id, ...buildServerPayload() });
    handleResetForm();
  };

  const handleStartEdit = (server: McpServerData) => {
    setEditingId(server.id);
    setFormState({
      name: server.name,
      type: server.type,
      command: server.command ?? '',
      args: formatArgumentsJson(server.launchArgs),
      env: formatKeyValuesJson(server.launchEnv),
      url: server.url ?? '',
      headers: formatKeyValuesJson(server.headers),
      approvalPolicy: server.approvalPolicy,
    });
    setIsAddingNew(false);
  };

  const handleToggle = (server: McpServerData, checked: boolean) => {
    updateMcpServer({ id: server.id, enabled: checked });
  };

  const handleToolOverride = (
    serverId: string,
    toolPermissions: string | null | undefined,
    toolName: string,
    val: 'always_prompt' | 'auto_approve' | 'deny' | 'inherit',
  ) => {
    const updatedJson = updateToolOverride(toolPermissions, toolName, val);
    updateMcpServer({ id: serverId, toolPermissions: updatedJson });
  };

  const showForm = isAddingNew || editingId;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between pr-10">
        <div>
          <h2 className="text-text-main text-lg font-bold">MCP Servers</h2>
          <p className="text-text-muted mt-0.5 text-xs">
            Connect local and remote Model Context Protocol tools to extend your agents.
          </p>
        </div>
        {!showForm && (
          <Button
            variant="outline"
            onClick={() => {
              setIsAddingNew(true);
            }}
            className="border-border/50 bg-surface/30 hover:border-accent/30 hover:bg-surface/50 flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Server
          </Button>
        )}
      </div>

      <div className="space-y-4">
        {showForm && (
          <McpServerForm
            formState={formState}
            onChange={setFormState}
            onSave={
              editingId
                ? () => {
                    handleSaveEdit(editingId);
                  }
                : handleSaveNew
            }
            onCancel={handleResetForm}
            isEditing={!!editingId}
          />
        )}

        {isLoading ? (
          <div className="animate-pulse space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-20 rounded-xl border border-white/5 bg-white/5" />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {mcpServers.map((server) => (
              <McpServerCard
                key={server.id}
                server={server}
                isExpanded={expandedServers[server.id] ?? false}
                onToggleExpand={() => {
                  toggleServerExpanded(server.id);
                }}
                onToggleEnabled={(checked) => {
                  handleToggle(server, checked);
                }}
                onEdit={() => {
                  handleStartEdit(server);
                }}
                onDelete={() => {
                  if (confirm(`Are you sure you want to delete ${server.name}?`)) {
                    deleteMcpServer(server.id);
                  }
                }}
                onUpdatePolicy={(val) => {
                  updateMcpServer({
                    id: server.id,
                    approvalPolicy: val as McpServerData['approvalPolicy'],
                  });
                }}
                onUpdateToolPermission={(toolName, val) => {
                  handleToolOverride(server.id, server.toolPermissions, toolName, val);
                }}
              />
            ))}

            {mcpServers.length === 0 && !isAddingNew && (
              <Card className="border-border/30 bg-surface/10 hover:border-border/30 flex flex-col items-center justify-center gap-3 rounded-2xl border-dashed p-8 text-center">
                <div className="bg-surface-secondary/30 border-border/20 flex h-12 w-12 items-center justify-center rounded-full border">
                  <Cpu className="text-text-muted/40 h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-text-main text-sm font-semibold">
                    No MCP Servers Configured
                  </h3>
                  <p className="text-text-muted mt-1 max-w-sm text-center text-xs leading-relaxed">
                    Connect external tool servers to grant your AI agents custom tools and
                    capabilities.
                  </p>
                </div>
                <Button
                  onClick={() => {
                    setIsAddingNew(true);
                  }}
                  className="bg-accent hover:bg-accent/80 text-brand-crust mt-2 flex h-8 items-center gap-1 rounded-lg px-3.5 text-xs font-semibold"
                >
                  <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
                  Add First Server
                </Button>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
