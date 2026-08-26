import { memo } from 'react';
import type { DiffLine as DiffLineType } from '../../../../shared/lib/diff-parser';
import { highlightLine } from '../../../../shared/lib/code-highlighter';

interface DiffLineProps {
  line: DiffLineType | null;
  hideAdded?: boolean;
  hideRemoved?: boolean;
  language?: string;
  isSpacer?: boolean;
}

export const DiffLine = memo(function DiffLine({
  line,
  hideAdded = false,
  hideRemoved = false,
  language,
  isSpacer = false,
}: DiffLineProps) {
  if (isSpacer || !line) {
    return (
      <div className="bg-surface-tertiary/10 flex border-l-2 border-transparent font-mono text-[10px] leading-relaxed opacity-30 select-none">
        {!hideRemoved && <div className="w-9 shrink-0 pr-1.5 text-right">&nbsp;</div>}
        {!hideAdded && (
          <div
            className={`w-9 shrink-0 pr-1.5 text-right ${!hideRemoved ? 'border-border/10 border-r' : ''}`}
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
    ? 'bg-success/[0.08] hover:bg-success/[0.14]'
    : isRemoved
      ? 'bg-danger/[0.08] hover:bg-danger/[0.14]'
      : 'hover:bg-surface-secondary/20';

  const textColor = isAdded
    ? 'text-success/90'
    : isRemoved
      ? 'text-danger/70'
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
              ? 'bg-success/35 text-success ring-success/30 font-semibold'
              : 'bg-danger/35 text-danger ring-danger/30 font-semibold'
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
        isAdded ? 'border-success/40' : isRemoved ? 'border-danger/40' : 'border-transparent'
      }`}
    >
      {!hideRemoved && (
        <div className="text-text-muted/30 group-hover:text-text-muted/60 w-9 shrink-0 pr-1.5 text-right font-mono text-[10px] select-none">
          {line.oldLineNumber ?? ''}
        </div>
      )}
      {!hideAdded && (
        <div
          className={`text-text-muted/30 group-hover:text-text-muted/60 w-9 shrink-0 pr-1.5 text-right font-mono text-[10px] select-none ${
            !hideRemoved ? 'border-border/10 border-r' : ''
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
