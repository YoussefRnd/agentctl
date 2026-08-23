import { Card, Button, Input, Select } from '@agentctl/ui';
import { Settings, X, Check } from 'lucide-react';
import { type McpFormState, approvalPolicyOptions } from './McpUtils';

interface McpServerFormProps {
  formState: McpFormState;
  onChange: (state: McpFormState) => void;
  onSave: () => void;
  onCancel: () => void;
  isEditing: boolean;
}

type Setter = <K extends keyof McpFormState>(key: K, value: McpFormState[K]) => void;

export function McpServerForm({
  formState,
  onChange,
  onSave,
  onCancel,
  isEditing,
}: McpServerFormProps) {
  const set: Setter = (key, value) => {
    onChange({ ...formState, [key]: value });
  };

  return (
    <Card className="border-accent/20 bg-accent/5 space-y-5 rounded-2xl border p-5">
      <div className="border-border/10 flex items-center justify-between border-b pb-3">
        <h3 className="text-text-main flex items-center gap-2 text-[11px] font-black tracking-wider uppercase">
          <Settings className="h-3.5 w-3.5 animate-spin" />
          {isEditing ? 'EDIT SERVER' : 'REGISTER NEW SERVER'}
        </h3>
        <Button
          variant="ghost"
          onClick={onCancel}
          className="hover:bg-surface-secondary/40 h-7 w-7 rounded-full p-0"
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
            id="mcp-name"
            placeholder="Name"
            value={formState.name ?? ''}
            onChange={(e) => {
              set('name', e.target.value);
            }}
            className="bg-surface-secondary/35 border-border/55 focus:border-accent/40 h-9 w-full rounded-xl border text-xs"
          />
        </div>

        <div className="space-y-1">
          <span className="text-text-muted label-3xs block opacity-70">Server Type</span>
          <div className="border-border/30 bg-surface/40 flex w-fit gap-1 rounded-xl border p-1">
            {(['local', 'remote'] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => {
                  set('type', type);
                }}
                className={`cursor-pointer rounded-lg px-4 py-1 text-center text-[10px] font-bold tracking-wider uppercase transition-all ${
                  formState.type === type
                    ? 'bg-accent text-brand-crust font-black shadow-sm'
                    : 'text-text-muted hover:text-text-main hover:bg-surface-secondary/40'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        {formState.type === 'local' ? (
          <>
            <div className="space-y-1">
              <label htmlFor="mcp-command" className="text-text-muted label-3xs opacity-70">
                Command
              </label>
              <Input
                id="mcp-command"
                placeholder="Command (e.g. npx)"
                value={formState.command ?? ''}
                onChange={(e) => {
                  set('command', e.target.value);
                }}
                className="bg-surface-secondary/35 border-border/55 focus:border-accent/40 h-9 w-full rounded-xl border font-mono text-xs"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="mcp-args" className="text-text-muted label-3xs opacity-70">
                Arguments
              </label>
              <Input
                id="mcp-args"
                placeholder="Arguments (e.g. --debug)"
                value={formState.args ?? ''}
                onChange={(e) => {
                  set('args', e.target.value);
                }}
                className="bg-surface-secondary/35 border-border/55 focus:border-accent/40 h-9 w-full rounded-xl border font-mono text-xs"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="mcp-env" className="text-text-muted label-3xs opacity-70">
                Environment Variables
              </label>
              <textarea
                id="mcp-env"
                placeholder="KEY=VALUE (one per line)"
                value={formState.env ?? ''}
                onChange={(e) => {
                  set('env', e.target.value);
                }}
                className="bg-surface-secondary/30 border-border/40 focus:border-accent/40 max-h-[120px] min-h-[60px] w-full rounded-xl border p-3 font-mono text-xs focus:outline-none"
              />
            </div>
          </>
        ) : (
          <>
            <div className="space-y-1">
              <label htmlFor="mcp-url" className="text-text-muted label-3xs opacity-70">
                URL
              </label>
              <Input
                id="mcp-url"
                placeholder="URL (e.g. https://...)"
                value={formState.url ?? ''}
                onChange={(e) => {
                  set('url', e.target.value);
                }}
                className="bg-surface-secondary/35 border-border/55 focus:border-accent/40 h-9 w-full rounded-xl border font-mono text-xs"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="mcp-headers" className="text-text-muted label-3xs opacity-70">
                Headers
              </label>
              <textarea
                id="mcp-headers"
                placeholder="Authorization=Bearer xyz (one per line)"
                value={formState.headers ?? ''}
                onChange={(e) => {
                  set('headers', e.target.value);
                }}
                className="bg-surface-secondary/30 border-border/40 focus:border-accent/40 max-h-[120px] min-h-[60px] w-full rounded-xl border p-3 font-mono text-xs focus:outline-none"
              />
            </div>
          </>
        )}
      </div>

      <div className="border-border/10 flex items-center justify-between border-t pt-4">
        <div className="flex items-center gap-3 select-none">
          <label
            htmlFor="mcp-form-approval-policy"
            className="text-text-muted text-[10px] font-bold tracking-wider uppercase"
          >
            Approval Policy
          </label>
          <Select
            value={formState.approvalPolicy}
            onChange={(val) => {
              set('approvalPolicy', val as McpFormState['approvalPolicy']);
            }}
            options={approvalPolicyOptions}
            className="w-48"
          />
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={onCancel}
            className="hover:bg-surface-secondary/40 text-text-muted h-9 rounded-xl px-4 text-[11px] font-bold tracking-widest uppercase"
          >
            CANCEL
          </Button>
          <Button
            onClick={onSave}
            className="bg-accent hover:bg-accent/80 text-brand-crust flex h-9 items-center gap-1.5 rounded-xl px-5 text-[11px] font-black tracking-widest uppercase"
          >
            <Check className="h-3.5 w-3.5 stroke-[3]" />
            SAVE_CONFIG
          </Button>
        </div>
      </div>
    </Card>
  );
}
