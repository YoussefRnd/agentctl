import React from 'react';
import { FileCode, Folder, GitBranch, GitPullRequest, GitCommit, Sparkles, X } from 'lucide-react';
import type { ContextItem, ContextItemType } from '@agentctl/api-client';

interface ContextChipStripProps {
  contexts: ContextItem[];
  onRemove: (id: string) => void;
}

export function ContextChipStrip({ contexts, onRemove }: ContextChipStripProps) {
  if (contexts.length === 0) return null;

  const renderIcon = (type: ContextItemType, id: string) => {
    if (type === 'file') {
      return <FileCode className="h-3 w-3 shrink-0 text-cyan-400" />;
    }
    if (type === 'folder') {
      return <Folder className="h-3 w-3 shrink-0 text-amber-400" />;
    }
    if (type === 'git') {
      if (id === 'git:diff') return <GitPullRequest className="h-3 w-3 shrink-0 text-purple-400" />;
      if (id === 'git:staged') return <GitBranch className="h-3 w-3 shrink-0 text-emerald-400" />;
      if (id === 'git:log') return <GitCommit className="h-3 w-3 shrink-0 text-blue-400" />;
      return <GitBranch className="h-3 w-3 shrink-0 text-purple-400" />;
    }
    return <Sparkles className="text-accent h-3 w-3 shrink-0" />;
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-5 pt-3 pb-0">
      {contexts.map((ctx) => (
        <div
          key={ctx.id}
          className="border-border/40 bg-surface-secondary/50 group/chip hover:border-accent/40 flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs shadow-sm transition-all duration-150"
        >
          {renderIcon(ctx.type, ctx.id)}
          <span className="text-text-main max-w-[180px] truncate font-mono text-[11px] font-medium">
            {ctx.title}
          </span>
          <button
            type="button"
            onClick={() => onRemove(ctx.id)}
            className="text-text-muted -mr-0.5 ml-0.5 flex h-4 w-4 items-center justify-center rounded transition-colors hover:bg-rose-500/10 hover:text-rose-400"
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
