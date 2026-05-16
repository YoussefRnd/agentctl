import type { DiffLine as DiffLineType } from '../../utils/diff-parser';

interface DiffLineProps {
  line: DiffLineType;
}

export function DiffLine({ line }: DiffLineProps) {
  const isAdded = line.type === 'added';
  const isRemoved = line.type === 'removed';

  const bgColor = isAdded ? 'bg-success/10' : isRemoved ? 'bg-danger/10' : '';
  const textColor = isAdded ? 'text-success' : isRemoved ? 'text-danger' : 'text-text-muted';
  const symbol = isAdded ? '+' : isRemoved ? '-' : ' ';

  const renderContent = () => {
    if (!line.highlights || line.highlights.length === 0) {
      return line.content;
    }

    const segments = [];
    let lastIndex = 0;

    line.highlights.forEach((highlight, idx) => {
      // Add non-highlighted segment
      if (highlight.start > lastIndex) {
        segments.push(line.content.slice(lastIndex, highlight.start));
      }

      // Add highlighted segment
      segments.push(
        <span
          key={idx}
          className={`${isAdded ? 'bg-success/30' : 'bg-danger/30'} rounded-sm`}
        >
          {line.content.slice(highlight.start, highlight.end)}
        </span>
      );

      lastIndex = highlight.end;
    });

    // Add remaining non-highlighted segment
    if (lastIndex < line.content.length) {
      segments.push(line.content.slice(lastIndex));
    }

    return segments;
  };

  return (
    <div className={`flex font-mono text-xs leading-5 ${bgColor} group hover:bg-surface-hover/50 transition-colors`}>
      <div className="w-12 shrink-0 select-none text-right pr-2 border-r border-border/30 opacity-40">
        {line.oldLineNumber ?? ''}
      </div>
      <div className="w-12 shrink-0 select-none text-right pr-2 border-r border-border/30 opacity-40">
        {line.newLineNumber ?? ''}
      </div>
      <div className={`w-6 shrink-0 select-none text-center opacity-60 ${textColor}`}>
        {symbol}
      </div>
      <div className="flex-1 px-1 break-all whitespace-pre-wrap">
        {renderContent()}
      </div>
    </div>
  );
}
