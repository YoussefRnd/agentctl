import { memo } from 'react';
import type { DiffLine as DiffLineType } from '../../../../utils/diff-parser';

interface DiffLineProps {
  line: DiffLineType;
  hideAdded?: boolean;
  hideRemoved?: boolean;
}

const syntaxHighlight = (content: string) => {
  const regex =
    /(\/\/.*|\/\*[\s\S]*?\*\/|'.*?'|".*?"|`.*?`|\b(?:function|const|let|var|return|if|else|import|from|export|default|class|interface|type|extends|implements|new|await|async|switch|case|break|try|catch)\b)/g;

  const parts = content.split(regex);
  return parts.map((part, i) => {
    if (!part) return null;
    const key = `${String(i)}-${part.slice(0, 10)}`;
    if (part.startsWith('//') || part.startsWith('/*')) {
      return (
        <span key={key} className="text-text-muted/40 italic">
          {part}
        </span>
      );
    }
    if (part.startsWith("'") || part.startsWith('"') || part.startsWith('`')) {
      return (
        <span key={key} className="text-warning/80">
          {part}
        </span>
      );
    }
    if (
      /^(function|const|let|var|return|if|else|import|from|export|default|class|interface|type|extends|implements|new|await|async|switch|case|break|try|catch)$/.test(
        part,
      )
    ) {
      return (
        <span key={key} className="text-accent/80 font-bold">
          {part}
        </span>
      );
    }
    return <span key={key}>{part}</span>;
  });
};

export const DiffLine = memo(function DiffLine({
  line,
  hideAdded = false,
  hideRemoved = false,
}: DiffLineProps) {
  const isAdded = line.type === 'added';
  const isRemoved = line.type === 'removed';

  if (hideAdded && isAdded) return null;
  if (hideRemoved && isRemoved) return null;

  const bgColor = isAdded
    ? 'bg-success/[0.08] hover:bg-success/[0.12]'
    : isRemoved
      ? 'bg-danger/[0.08] hover:bg-danger/[0.12]'
      : 'hover:bg-surface-secondary/20';

  const textColor = isAdded
    ? 'text-success/90'
    : isRemoved
      ? 'text-danger/70 line-through decoration-danger/30'
      : 'text-text-main/60';

  const symbol = isAdded ? '+' : isRemoved ? '-' : ' ';

  const getLineContent = () => {
    if (!line.highlights || line.highlights.length === 0) {
      return syntaxHighlight(line.content);
    }

    const segments = [];
    let lastIndex = 0;

    line.highlights.forEach((highlight) => {
      if (highlight.start > lastIndex) {
        segments.push(syntaxHighlight(line.content.slice(lastIndex, highlight.start)));
      }

      segments.push(
        <span
          key={`${String(highlight.start)}-${String(highlight.end)}`}
          className={`${isAdded ? 'bg-success/30 text-success' : 'bg-danger/30 text-danger'} ring-border/10 rounded-sm px-0.5 font-black shadow-sm ring-1`}
        >
          {line.content.slice(highlight.start, highlight.end)}
        </span>,
      );

      lastIndex = highlight.end;
    });

    if (lastIndex < line.content.length) {
      segments.push(syntaxHighlight(line.content.slice(lastIndex)));
    }

    return segments;
  };

  return (
    <div
      className={`flex font-mono text-[10px] leading-relaxed ${bgColor} group border-l-2 transition-all duration-150 ${isAdded ? 'border-success/30' : isRemoved ? 'border-danger/30' : 'border-transparent'}`}
    >
      {!hideRemoved && (
        <div className="text-text-muted/20 group-hover:text-text-muted/40 w-9 shrink-0 pr-1.5 text-right font-bold tracking-tighter select-none">
          {line.oldLineNumber ?? ''}
        </div>
      )}
      {!hideAdded && (
        <div
          className={`text-text-muted/20 group-hover:text-text-muted/40 w-9 shrink-0 pr-1.5 text-right font-bold tracking-tighter select-none ${!hideRemoved ? 'border-border/10 border-r' : ''}`}
        >
          {line.newLineNumber ?? ''}
        </div>
      )}
      <div className={`w-4 shrink-0 text-center font-black opacity-30 select-none ${textColor}`}>
        {symbol}
      </div>
      <div
        className={`flex-1 px-1.5 break-all whitespace-pre-wrap ${textColor} selection:bg-accent/30 selection:text-white`}
      >
        {getLineContent()}
      </div>
    </div>
  );
});
