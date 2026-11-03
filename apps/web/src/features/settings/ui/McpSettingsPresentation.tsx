import { McpCardsLayout } from './SettingsListLayouts';
import { McpServerCardSkeleton } from './McpServerCard';
import { SettingsListLayout } from './SettingsListLayouts';
import { useState } from 'react';
import type { McpToolData, useMcpServers } from '../api/useMcpServers';
import { Card, Button, LoadingSkeleton, ConfirmationModal } from '@agentctl/ui';
import { Server, Plus } from 'lucide-react';
import { toast } from 'sonner';
import {
  parseArgumentsText,
  parseKeyValuesText,
  formatKeyValuesJson,
  formatArgumentsJson,
  initialFormState,
  updateToolOverride,
  type McpFormState,
  type McpFormError,
  validateMcpForm,
} from './McpUtils';
import { McpServerForm } from './McpServerForm';
import { McpServerCardPresentation } from './McpServerCard';
import type { McpServerData } from '../api/useMcpServers';

export function McpSettingsPresentation({
  api,
  tools,
}: {
  api: ReturnType<typeof useMcpServers>;
  tools: McpToolData[];
}) {
  const { mcpServers, isLoading, addMcpServer, updateMcpServer, deleteMcpServer } = api;
  const [formError, setFormError] = useState<McpFormError | null>(null);
  const [deletingServer, setDeletingServer] = useState<McpServerData | null>(null);
  const isSaving = api.isAdding || api.isUpdating;
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedServers, setExpandedServers] = useState<Record<string, boolean>>({});
  const [formState, setFormState] = useState<McpFormState>(initialFormState);

  const toggleServerExpanded = (id: string) => {
    setExpandedServers((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleResetForm = () => {
    setFormError(null);
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
    const error = validateMcpForm(formState);
    setFormError(error);
    if (error) {
      toast.error(error.message);
      return false;
    }
    return true;
  };

  const handleSaveNew = () => {
    if (isSaving || !validate()) return;
    const generatedId = formState.name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/[\s_-]+/g, '-');
    addMcpServer(
      { id: generatedId, ...buildServerPayload(), enabled: true, autoApprove: false },
      { onSuccess: handleResetForm },
    );
  };

  const handleSaveEdit = (id: string) => {
    if (isSaving || !validate()) return;
    updateMcpServer({ id, ...buildServerPayload() }, { onSuccess: handleResetForm });
  };

  const handleStartEdit = (server: McpServerData) => {
    setFormError(null);
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
    <SettingsListLayout
      section="mcp"
      actions={
        <>
          {!showForm && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setIsAddingNew(true);
              }}
              className="border-border/50 bg-surface/30 hover:border-accent/30 hover:bg-surface/50 flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5 shrink-0" />
              <span>Add Server</span>
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {showForm && (
          <McpServerForm
            formState={formState}
            onChange={(next) => {
              setFormError(null);
              setFormState(next);
            }}
            error={formError}
            isSaving={isSaving}
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
          <LoadingSkeleton message="Loading MCP servers…" className="space-y-3">
            <McpCardsLayout>
              {Array.from({ length: 2 }, (_, i) => (
                <McpServerCardSkeleton key={i} />
              ))}
            </McpCardsLayout>
          </LoadingSkeleton>
        ) : (
          <McpCardsLayout>
            {mcpServers.map((server) => (
              <McpServerCardPresentation
                mcpTools={tools}
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
                onDelete={() => setDeletingServer(server)}
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
              <Card className="border-border/30 bg-surface/10 hover:border-border/30 flex flex-col items-center justify-center gap-3 border-dashed p-8 text-center">
                <div className="bg-surface-secondary/30 border-border/20 flex h-12 w-12 items-center justify-center rounded-full border">
                  <Server className="text-text-muted/40 h-6 w-6" />
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
          </McpCardsLayout>
        )}
      </div>
      <ConfirmationModal
        isOpen={deletingServer !== null}
        title="Delete MCP server"
        message={`Are you sure you want to delete ${deletingServer?.name ?? 'this server'}?`}
        confirmText="Delete server"
        type="danger"
        isConfirming={api.isDeleting}
        onCancel={() => setDeletingServer(null)}
        onConfirm={() => {
          if (deletingServer && !api.isDeleting)
            deleteMcpServer(deletingServer.id, { onSuccess: () => setDeletingServer(null) });
        }}
      />
    </SettingsListLayout>
  );
}
