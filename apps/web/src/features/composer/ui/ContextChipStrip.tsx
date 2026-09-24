import React from 'react';
import { Folder, Code2, X } from 'lucide-react';
import { DiffIcon, GitBranchIcon, GitCommitIcon } from '@primer/octicons-react';
import type { ContextItem } from '@agentctl/api-client';
import { FileIcon } from '@/shared';
import { IconButton } from '@agentctl/ui';

interface ContextChipStripProps {
  contexts: ContextItem[];
  onRemove: (id: string) => void;
}

function renderContextIcon(ctx: ContextItem) {
  if (ctx.type === 'file') {
    return <FileIcon path={ctx.title} className="h-3.5 w-3.5 shrink-0" />;
  }
  if (ctx.type === 'folder') {
    return <Folder className="h-3.5 w-3.5 shrink-0 text-amber-400" />;
  }
  if (ctx.type === 'git') {
    if (ctx.id === 'git:diff') return <DiffIcon className="h-3.5 w-3.5 shrink-0 text-purple-400" />;
    if (ctx.id === 'git:staged')
      return <GitBranchIcon className="h-3.5 w-3.5 shrink-0 text-emerald-400" />;
    if (ctx.id === 'git:log')
      return <GitCommitIcon className="h-3.5 w-3.5 shrink-0 text-blue-400" />;
    return <GitBranchIcon className="h-3.5 w-3.5 shrink-0 text-purple-400" />;
  }
  return <Code2 className="text-accent h-3.5 w-3.5 shrink-0" />;
}

export function ContextChipStrip({ contexts, onRemove }: ContextChipStripProps) {
  if (contexts.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 pt-3 pb-0 sm:px-5">
      {contexts.map((ctx) => (
        <div
          key={ctx.id}
          className="border-border/30 bg-surface/70 hover:bg-surface hover:border-accent/40 group/chip flex items-center gap-1.5 rounded-full border py-0.5 pr-1 pl-2.5 text-xs shadow-xs backdrop-blur-sm transition-[color,background-color,border-color] duration-150"
        >
          {renderContextIcon(ctx)}
          <span className="text-text-main max-w-[180px] truncate font-mono text-[11px] font-medium">
            {ctx.title}
          </span>
          <IconButton
            onClick={() => onRemove(ctx.id)}
            size="sm"
            className="ml-0.5 h-5 w-5 rounded-full p-0 hover:bg-rose-500/15 hover:text-rose-400"
            title={`Remove ${ctx.title}`}
            aria-label={`Remove ${ctx.title}`}
          >
            <X className="h-2.5 w-2.5" />
          </IconButton>
        </div>
      ))}
    </div>
  );
}
