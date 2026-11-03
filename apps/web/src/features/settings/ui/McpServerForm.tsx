import { SegmentedControl } from '@agentctl/ui';
import { Card, Button, Input, Select, useFieldAccessibility } from '@agentctl/ui';
import { useEffect, useRef } from 'react';
import { Settings, X, Check } from 'lucide-react';
import { type McpFormState, type McpFormError, approvalPolicyOptions } from './McpUtils';

interface McpServerFormProps {
  formState: McpFormState;
  onChange: (state: McpFormState) => void;
  onSave: () => void;
  onCancel: () => void;
  isEditing: boolean;
  error?: McpFormError | null;
  isSaving?: boolean;
}

type Setter = <K extends keyof McpFormState>(key: K, value: McpFormState[K]) => void;

export function McpServerForm({
  formState,
  onChange,
  onSave,
  onCancel,
  isEditing,
  error,
  isSaving = false,
}: McpServerFormProps) {
  const nameRef = useRef<HTMLInputElement>(null);
  const commandRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const nameField = useFieldAccessibility({
    id: 'mcp-name',
    required: true,
    error: error?.field === 'name' ? error.message : undefined,
  });
  const commandField = useFieldAccessibility({
    id: 'mcp-command',
    required: true,
    error: error?.field === 'command' ? error.message : undefined,
  });
  const urlField = useFieldAccessibility({
    id: 'mcp-url',
    required: true,
    error: error?.field === 'url' ? error.message : undefined,
  });
  useEffect(() => {
    if (error) ({ name: nameRef, command: commandRef, url: urlRef })[error.field].current?.focus();
  }, [error]);
  const set: Setter = (key, value) => {
    onChange({ ...formState, [key]: value });
  };

  return (
    <Card className="border-accent/20 bg-accent/5 space-y-5 border p-5">
      <div className="border-border/10 flex items-center justify-between border-b pb-3">
        <h3 className="text-text-main flex items-center gap-2 text-xs font-bold tracking-tight">
          <Settings className="text-accent h-3.5 w-3.5" />
          <span>{isEditing ? 'Edit MCP Server' : 'Register New MCP Server'}</span>
        </h3>
        <Button
          variant="ghost"
          onClick={onCancel}
          disabled={isSaving}
          aria-label="Cancel server form"
          className="hover:bg-surface-secondary/40 h-7 w-7 cursor-pointer rounded-md p-0"
        >
          <X className="text-text-muted h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="mcp-name" className="text-text-muted label-3xs opacity-70">
            Display Name
          </label>
          <Input
            {...nameField.controlProps}
            ref={nameRef}
            disabled={isSaving}
            placeholder="Server name (e.g. GitHub, Filesystem, Cloudflare MCP)"
            value={formState.name ?? ''}
            onChange={(e) => {
              set('name', e.target.value);
            }}
            className="bg-surface-secondary/35 border-border/55 focus:border-accent/40 h-9 w-full rounded-md border text-xs"
          />
        </div>

        <div className="space-y-1">
          <span className="text-text-muted label-3xs block opacity-70">Server Type</span>
          <SegmentedControl
            aria-label="Server Type"
            value={formState.type}
            onValueChange={(type) => set('type', type)}
            disabled={isSaving}
            className="w-fit"
            options={[
              { value: 'local', label: 'Local (stdio)' },
              { value: 'remote', label: 'Remote (Stateless HTTP / SSE)' },
            ]}
          />
        </div>

        {formState.type === 'local' ? (
          <>
            <div className="space-y-1">
              <label htmlFor="mcp-command" className="text-text-muted label-3xs opacity-70">
                Command
              </label>
              <Input
                {...commandField.controlProps}
                ref={commandRef}
                disabled={isSaving}
                placeholder="Command (e.g. npx, uvx, python)"
                value={formState.command ?? ''}
                onChange={(e) => {
                  set('command', e.target.value);
                }}
                className="bg-surface-secondary/35 border-border/55 focus:border-accent/40 h-9 w-full rounded-md border font-mono text-xs"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="mcp-args" className="text-text-muted label-3xs opacity-70">
                Arguments
              </label>
              <Input
                id="mcp-args"
                disabled={isSaving}
                placeholder="Arguments (e.g. -y @modelcontextprotocol/server-filesystem /path)"
                value={formState.args ?? ''}
                onChange={(e) => {
                  set('args', e.target.value);
                }}
                className="bg-surface-secondary/35 border-border/55 focus:border-accent/40 h-9 w-full rounded-md border font-mono text-xs"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="mcp-env" className="text-text-muted label-3xs opacity-70">
                Environment Variables
              </label>
              <textarea
                id="mcp-env"
                disabled={isSaving}
                placeholder="KEY=VALUE (one per line)"
                value={formState.env ?? ''}
                onChange={(e) => {
                  set('env', e.target.value);
                }}
                className="bg-surface-secondary/30 border-border/40 focus:border-accent/40 max-h-[120px] min-h-[60px] w-full resize-y rounded-md border p-3 font-mono text-xs focus:outline-none"
              />
            </div>
          </>
        ) : (
          <>
            <div className="space-y-1">
              <label htmlFor="mcp-url" className="text-text-muted label-3xs opacity-70">
                Endpoint URL
              </label>
              <Input
                {...urlField.controlProps}
                ref={urlRef}
                disabled={isSaving}
                placeholder="https://mcp.your-domain.com/mcp or https://... (Streamable HTTP)"
                value={formState.url ?? ''}
                onChange={(e) => {
                  set('url', e.target.value);
                }}
                className="bg-surface-secondary/35 border-border/55 focus:border-accent/40 h-9 w-full rounded-md border font-mono text-xs"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="mcp-headers" className="text-text-muted label-3xs opacity-70">
                HTTP Headers &amp; Authentication
              </label>
              <textarea
                id="mcp-headers"
                disabled={isSaving}
                placeholder="Authorization=Bearer your_token_here (one per line)&#10;Mcp-Version=2026-07-28"
                value={formState.headers ?? ''}
                onChange={(e) => {
                  set('headers', e.target.value);
                }}
                className="bg-surface-secondary/30 border-border/40 focus:border-accent/40 max-h-[120px] min-h-[60px] w-full resize-y rounded-md border p-3 font-mono text-xs focus:outline-none"
              />
            </div>
          </>
        )}
      </div>

      <div className="border-border/10 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <div className="flex min-w-0 flex-wrap items-center gap-3 select-none">
          <label
            htmlFor="mcp-form-approval-policy"
            className="text-text-muted text-xs font-semibold"
          >
            Approval Policy
          </label>
          <Select
            id="mcp-form-approval-policy"
            disabled={isSaving}
            value={formState.approvalPolicy}
            onChange={(val) => {
              set('approvalPolicy', val as McpFormState['approvalPolicy']);
            }}
            options={approvalPolicyOptions}
            className="w-48 max-w-full"
          />
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            onClick={onCancel}
            disabled={isSaving}
            className="hover:bg-surface-secondary/40 text-text-muted h-8 cursor-pointer rounded-lg px-3.5 text-xs font-medium"
          >
            Cancel
          </Button>
          <Button
            onClick={onSave}
            disabled={isSaving}
            className="bg-accent hover:bg-accent/80 text-brand-crust flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-4 text-xs font-bold"
          >
            <Check className="h-3.5 w-3.5 stroke-[2.5]" />
            Save Server
          </Button>
        </div>
      </div>
      {error && (
        <p
          id={
            error.field === 'name'
              ? nameField.errorId
              : error.field === 'command'
                ? commandField.errorId
                : urlField.errorId
          }
          className="sr-only"
        >
          {error.message}
        </p>
      )}
    </Card>
  );
}
