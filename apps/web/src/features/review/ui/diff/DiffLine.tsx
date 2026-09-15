import { memo } from 'react';
import type { DiffLine as DiffLineType } from '@/shared/lib/diff-parser';
import { highlightLine } from '@/shared/lib/code-highlighter';

interface DiffLineProps {
  line: DiffLineType | null;
  hideAdded?: boolean;
  hideRemoved?: boolean;
  hideOldLineNumber?: boolean;
  hideNewLineNumber?: boolean;
  language?: string;
  isSpacer?: boolean;
}

export const DiffLine = memo(function DiffLine({
  line,
  hideAdded = false,
  hideRemoved = false,
  hideOldLineNumber = false,
  hideNewLineNumber = false,
  language,
  isSpacer = false,
}: DiffLineProps) {
  const showOld = !hideRemoved && !hideOldLineNumber;
  const showNew = !hideAdded && !hideNewLineNumber;

  if (isSpacer || !line) {
    return (
      <div className="bg-surface-tertiary/10 flex border-l-2 border-transparent font-mono text-[10px] leading-relaxed opacity-30 select-none">
        {showOld && (
          <div className="w-7 shrink-0 pr-1.5 text-right font-mono text-[9.5px] tabular-nums">
            &nbsp;
          </div>
        )}
        {showNew && (
          <div
            className={`w-7 shrink-0 pr-1.5 text-right font-mono text-[9.5px] tabular-nums ${showOld ? 'border-border/10 border-r' : ''}`}
          >
            &nbsp;
          </div>
        )}
        <div className="w-4 shrink-0">&nbsp;</div>
        <div className="flex-1 px-1.5">&nbsp;</div>
      </div>
    );
  }

  const isAdded = line.type === 'added';
  const isRemoved = line.type === 'removed';

  if (hideAdded && isAdded) return null;
  if (hideRemoved && isRemoved) return null;

  const bgColor = isAdded
    ? 'bg-emerald-500/[0.10] hover:bg-emerald-500/[0.16]'
    : isRemoved
      ? 'bg-rose-500/[0.10] hover:bg-rose-500/[0.16]'
      : 'hover:bg-surface-secondary/20';

  const textColor = isAdded
    ? 'text-emerald-400/95'
    : isRemoved
      ? 'text-rose-400/90'
      : 'text-text-main/80';

  const symbol = isAdded ? '+' : isRemoved ? '-' : ' ';

  const renderContent = () => {
    if (!line.highlights || line.highlights.length === 0) {
      const html = highlightLine(line.content, language);
      return <span dangerouslySetInnerHTML={{ __html: html }} />;
    }

    const segments: React.ReactNode[] = [];
    let lastIndex = 0;

    line.highlights.forEach((highlight, hIdx) => {
      if (highlight.start > lastIndex) {
        const textSlice = line.content.slice(lastIndex, highlight.start);
        const html = highlightLine(textSlice, language);
        segments.push(
          <span key={`seg-${String(hIdx)}-pre`} dangerouslySetInnerHTML={{ __html: html }} />,
        );
      }

      const diffSlice = line.content.slice(highlight.start, highlight.end);
      segments.push(
        <span
          key={`diff-${String(highlight.start)}-${String(highlight.end)}`}
          className={`${
            isAdded
              ? 'bg-emerald-500/35 font-semibold text-emerald-300 ring-emerald-500/30'
              : 'bg-rose-500/35 font-semibold text-rose-300 ring-rose-500/30'
          } rounded px-0.5 shadow-xs ring-1`}
        >
          {diffSlice}
        </span>,
      );

      lastIndex = highlight.end;
    });

    if (lastIndex < line.content.length) {
      const remainingSlice = line.content.slice(lastIndex);
      const html = highlightLine(remainingSlice, language);
      segments.push(<span key="seg-tail" dangerouslySetInnerHTML={{ __html: html }} />);
    }

    return segments;
  };

  return (
    <div
      className={`flex font-mono text-[10.5px] leading-relaxed ${bgColor} group border-l-2 transition-colors duration-150 ${
        isAdded ? 'border-emerald-500/70' : isRemoved ? 'border-rose-500/70' : 'border-transparent'
      }`}
    >
      {showOld && (
        <div className="text-text-muted/30 group-hover:text-text-muted/60 w-7 shrink-0 pr-1.5 text-right font-mono text-[9.5px] tabular-nums select-none">
          {line.oldLineNumber ?? ''}
        </div>
      )}
      {showNew && (
        <div
          className={`text-text-muted/30 group-hover:text-text-muted/60 w-7 shrink-0 pr-1.5 text-right font-mono text-[9.5px] tabular-nums select-none ${
            showOld ? 'border-border/10 border-r' : ''
          }`}
        >
          {line.newLineNumber ?? ''}
        </div>
      )}
      <div className={`w-4 shrink-0 text-center font-bold opacity-40 select-none ${textColor}`}>
        {symbol}
      </div>
      <div
        className={`flex-1 px-1.5 font-mono text-[10.5px] break-all whitespace-pre-wrap ${textColor} selection:bg-accent/30 selection:text-white`}
      >
        {renderContent()}
      </div>
    </div>
  );
});
