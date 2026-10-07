import { memo } from 'react';
import type { ConversationTurn } from '../lib/turnMinimapGrouping';

interface TurnPreviewPopoverProps {
  turn: ConversationTurn;
}

export const TurnPreviewPopover = memo(function TurnPreviewPopover({
  turn,
}: TurnPreviewPopoverProps) {
  const { userPrompt, turnSummary, diffStats, modelName, providerName, providerIcon } = turn;
  const hasDiffs = diffStats.additions > 0 || diffStats.deletions > 0;

  return (
    <div
      role="tooltip"
      className="border-border/40 bg-brand-mantle/98 ring-border/20 pointer-events-none w-[min(320px,calc(100vw-2rem))] rounded-lg border p-3.5 shadow-2xl ring-1 backdrop-blur-2xl select-none"
    >
      {/* 1. User Prompt */}
      <p className="text-text-main line-clamp-2 text-[12.5px] leading-snug font-semibold tracking-tight">
        {userPrompt || 'Empty prompt'}
      </p>

      {/* 2. Turn Summary */}
      {turnSummary && (
        <div className="mt-2.5">
          <div className="text-text-muted/60 text-[9.5px] font-bold tracking-wider uppercase">
            Turn Summary
          </div>
          <p className="text-text-muted mt-1 line-clamp-4 text-[11.5px] leading-relaxed">
            {turnSummary}
          </p>
        </div>
      )}

      {/* 3. Metadata: Model, Provider & Diff Stats */}
      {(modelName || hasDiffs) && (
        <div className="border-border/20 mt-3 space-y-1.5 border-t pt-2.5 text-[11px]">
          {/* Model & Provider Info */}
          {modelName && (
            <div className="text-text-muted flex items-center gap-1.5">
              {providerIcon && (
                <img src={providerIcon} alt="" className="h-3.5 w-3.5 object-contain" />
              )}
              <span className="truncate">
                <span className="text-text-main/90 font-medium">{modelName}</span>
                {providerName ? (
                  <span className="text-text-muted/60"> via {providerName}</span>
                ) : null}
              </span>
            </div>
          )}

          {/* Code Diff Stats */}
          {hasDiffs && (
            <div className="flex items-center gap-1.5 font-mono text-[11px]">
              <span className="text-text-muted/60">±</span>
              <span className="text-emerald-400">+{diffStats.additions}</span>
              <span className="text-rose-400">-{diffStats.deletions}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
