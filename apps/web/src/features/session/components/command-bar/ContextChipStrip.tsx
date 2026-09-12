import React from 'react';
import { Folder, Code2, X } from 'lucide-react';
import { DiffIcon, GitBranchIcon, GitCommitIcon } from '@primer/octicons-react';
import type { ContextItem } from '@agentctl/api-client';
import { FileIcon } from '@/shared';

interface ContextChipStripProps {
  contexts: ContextItem[];
  onRemove: (id: string) => void;
}

function renderContextIcon(ctx: ContextItem) {
  if (ctx.type === 'file') {
    return <FileIcon path={ctx.title} className="h-3 w-3 shrink-0" />;
  }
  if (ctx.type === 'folder') {
    return <Folder className="h-3 w-3 shrink-0 text-amber-400" />;
  }
  if (ctx.type === 'git') {
    if (ctx.id === 'git:diff') return <DiffIcon className="h-3 w-3 shrink-0 text-purple-400" />;
    if (ctx.id === 'git:staged')
      return <GitBranchIcon className="h-3 w-3 shrink-0 text-emerald-400" />;
    if (ctx.id === 'git:log') return <GitCommitIcon className="h-3 w-3 shrink-0 text-blue-400" />;
    return <GitBranchIcon className="h-3 w-3 shrink-0 text-purple-400" />;
  }
  return <Code2 className="text-accent h-3 w-3 shrink-0" />;
}

export function ContextChipStrip({ contexts, onRemove }: ContextChipStripProps) {
  if (contexts.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-5 pt-3 pb-0">
      {contexts.map((ctx) => (
        <div
          key={ctx.id}
          className="border-border/40 bg-surface-secondary/50 group/chip hover:border-accent/40 flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs shadow-sm transition-colors duration-150"
        >
          {renderContextIcon(ctx)}
          <span className="text-text-main max-w-[180px] truncate font-mono text-[11px] font-medium">
            {ctx.title}
          </span>
          <button
            type="button"
            onClick={() => onRemove(ctx.id)}
            className="text-text-muted -mr-0.5 ml-0.5 flex h-4 w-4 cursor-pointer items-center justify-center rounded transition-colors hover:bg-rose-500/10 hover:text-rose-400 active:scale-[0.97]"
            title={`Remove ${ctx.title}`}
            aria-label={`Remove ${ctx.title}`}
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
