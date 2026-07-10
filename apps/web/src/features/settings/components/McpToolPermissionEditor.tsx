import { getToolOverride } from './McpUtils';

interface McpToolPermissionEditorProps {
  toolName: string;
  description: string | null | undefined;
  toolPermissions: string | null | undefined;
  onUpdateOverride: (toolName: string, val: 'always_prompt' | 'auto_approve' | 'deny' | 'inherit') => void;
}

const overrideOptions = [
  { label: 'Inherit', value: 'inherit' },
  { label: 'Allow', value: 'auto_approve' },
  { label: 'Prompt', value: 'always_prompt' },
  { label: 'Deny', value: 'deny' },
] as const;

export function McpToolPermissionEditor({
  toolName,
  description,
  toolPermissions,
  onUpdateOverride,
}: McpToolPermissionEditorProps) {
  const shortName = toolName.split('__')[1] ?? toolName;
  const currentOverride = getToolOverride(toolPermissions, shortName);

  return (
    <div className="bg-surface/20 border-border/10 flex items-center justify-between gap-4 rounded-xl border px-3.5 py-2.5">
      <div className="min-w-0">
        <span className="text-accent font-mono text-[11px] font-black tracking-tight">
          {shortName}
        </span>
        {description && (
          <p className="text-text-muted mt-0.5 line-clamp-1 text-[10px] opacity-70">
            {description}
          </p>
        )}
      </div>

      <div className="bg-surface-secondary/85 border-border/20 flex gap-1 rounded-xl border p-1 select-none">
        {overrideOptions.map((opt) => (
          <button
            key={opt.value}
            id={`mcp-tool-override-${toolName}-${opt.value}`}
            type="button"
            onClick={() => { onUpdateOverride(shortName, opt.value); }}
            className={`cursor-pointer rounded-lg px-2.5 py-1 label-3xs transition-all ${
              currentOverride === opt.value
                ? 'bg-accent text-brand-crust shadow-sm'
                : 'text-text-muted hover:text-text-main hover:bg-white/5'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
