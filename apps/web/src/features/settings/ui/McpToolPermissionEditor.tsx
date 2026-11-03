import { SegmentedControl } from '@agentctl/ui';
import { getToolOverride } from './McpUtils';

interface McpToolPermissionEditorProps {
  toolName: string;
  description: string | null | undefined;
  toolPermissions: string | null | undefined;
  onUpdateOverride: (
    toolName: string,
    val: 'always_prompt' | 'auto_approve' | 'deny' | 'inherit',
  ) => void;
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

      <SegmentedControl
        aria-label={`Approval policy for ${shortName}`}
        typographyClassName="label-3xs"
        itemClassName="px-2.5 py-1"
        value={currentOverride}
        onValueChange={(value) => onUpdateOverride(shortName, value)}
        options={overrideOptions.map((opt) => ({
          ...opt,
          id: `mcp-tool-override-${toolName}-${opt.value}`,
        }))}
      />
    </div>
  );
}
