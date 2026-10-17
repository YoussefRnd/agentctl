import { structuredDiffSchema } from '@agentctl/shared';
import { cn } from '@agentctl/ui';
import type { ReactNode } from 'react';

export function ToolOutput({
  children,
  label = 'Tool output',
  action,
  className,
}: {
  children: ReactNode;
  label?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className="group/output border-border/25 bg-surface-secondary/30 relative max-w-full min-w-0 overflow-hidden rounded-md border">
      {action && <div className="absolute top-1.5 right-1.5 z-10">{action}</div>}
      <pre
        role="region"
        aria-label={label}
        tabIndex={0}
        className={cn(
          'custom-scrollbar text-text-main/90 focus-visible:ring-accent/40 max-h-60 max-w-full min-w-0 overflow-auto p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre select-text focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
          action && 'pr-10',
          className,
        )}
      >
        {children}
      </pre>
    </div>
  );
}

export function ToolLocations({
  locations,
  className,
}: {
  locations: { path?: string; line?: number }[];
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {locations.map((location, index) => (
        <code
          key={`${location.path || ''}:${String(location.line ?? index)}`}
          className="bg-surface-secondary/70 text-text-main border-border/25 rounded border px-1.5 py-0.5 font-mono text-[10px] break-all select-all"
        >
          {location.path}
          {typeof location.line === 'number' ? `:${String(location.line)}` : ''}
        </code>
      ))}
    </div>
  );
}

export function ToolDiffBlock({
  block,
  compact = false,
}: {
  block: Record<string, unknown>;
  compact?: boolean;
}) {
  const structured = structuredDiffSchema.safeParse(block);
  if (structured.success) {
    const { changes, patch } = structured.data;
    return (
      <section
        aria-label="File changes"
        className={cn(
          'border-border/15 overflow-hidden rounded-md border',
          'bg-surface-secondary/30',
          compact && 'my-1',
        )}
      >
        <ul className="border-border/15 bg-surface-secondary/40 divide-border/15 divide-y border-b">
          {changes.map((change, index) => (
            <li
              key={`${change.path}:${index}`}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2.5 py-2 text-[10px]"
            >
              <span className="text-text-muted capitalize">{change.operation}</span>
              <span className="text-text-main min-w-0 font-mono break-all">
                {change.oldPath ? `${change.oldPath} → ${change.path}` : change.path}
              </span>
              {change.fileType && <span className="text-text-muted">({change.fileType})</span>}
            </li>
          ))}
        </ul>
        {patch?.format === 'git_patch' ? (
          <pre
            role="region"
            aria-label="Diff patch"
            tabIndex={0}
            className={cn(
              'custom-scrollbar focus-visible:ring-accent/40 max-w-full overflow-auto p-2.5 font-mono leading-relaxed focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
              compact ? 'max-h-52 text-[10.5px]' : 'max-h-60 text-[11px]',
            )}
          >
            {patch.text.split('\n').map((line, index) => (
              <span
                key={index}
                className={cn(
                  'block',
                  line.startsWith('+')
                    ? 'text-success'
                    : line.startsWith('-')
                      ? 'text-danger'
                      : 'text-text-muted',
                )}
              >
                {line || '\u00a0'}
              </span>
            ))}
          </pre>
        ) : (
          <p className="text-text-muted p-2.5 text-[11px]">
            {patch
              ? `Patch format ${patch.format} is not supported.`
              : 'No text patch was provided.'}
          </p>
        )}
      </section>
    );
  }
  const path = typeof block.path === 'string' ? block.path : 'file';
  const oldText = typeof block.oldText === 'string' ? block.oldText : null;
  const newText = typeof block.newText === 'string' ? block.newText : '';
  return (
    <div
      className={cn(
        'border-border/15 overflow-hidden rounded-md border',
        'bg-surface-secondary/30',
        compact && 'my-1',
      )}
    >
      <div
        className={cn(
          'bg-surface-secondary/40 border-border/15 border-b px-2.5 py-1',
          compact && 'flex items-center',
        )}
      >
        <span className="text-text-muted font-mono text-[10px] break-all">{path}</span>
      </div>
      <ToolOutput label="Diff patch" className={compact ? 'max-h-52 text-[10.5px]' : undefined}>
        {oldText && (
          <span className="text-danger block">
            {oldText
              .split('\n')
              .map((line) => `- ${line}`)
              .join('\n')}
          </span>
        )}
        {newText && (
          <span className="text-success block">
            {newText
              .split('\n')
              .map((line) => `+ ${line}`)
              .join('\n')}
          </span>
        )}
      </ToolOutput>
    </div>
  );
}
