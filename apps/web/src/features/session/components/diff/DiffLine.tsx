import type { DiffLine as DiffLineType } from '../../../../utils/diff-parser';

interface DiffLineProps {
  line: DiffLineType;
}

export function DiffLine({ line }: DiffLineProps) {
  const isAdded = line.type === 'added';
  const isRemoved = line.type === 'removed';

  const bgColor = isAdded ? 'bg-white/10' : isRemoved ? 'bg-white/5' : '';
  const textColor = isAdded ? 'text-white font-bold' : isRemoved ? 'text-zinc-600 line-through' : 'text-zinc-400';
  const symbol = isAdded ? '+' : isRemoved ? '-' : ' ';

  const renderContent = () => {
    if (!line.highlights || line.highlights.length === 0) {
      return line.content;
    }

    const segments = [];
    let lastIndex = 0;

    line.highlights.forEach((highlight, idx) => {
      if (highlight.start > lastIndex) {
        segments.push(line.content.slice(lastIndex, highlight.start));
      }

      segments.push(
        <span key={idx} className={`${isAdded ? 'bg-white/20' : 'bg-white/10'} rounded-sm px-0.5`}>
          {line.content.slice(highlight.start, highlight.end)}
        </span>,
      );

      lastIndex = highlight.end;
    });

    if (lastIndex < line.content.length) {
      segments.push(line.content.slice(lastIndex));
    }

    return segments;
  };

  return (
    <div
      className={`flex font-mono text-[11px] leading-4 ${bgColor} transition-colors hover:bg-white/[0.08]`}
    >
      <div className="border-white/5 w-8 shrink-0 border-r pr-1 text-right opacity-20 select-none">
        {line.oldLineNumber ?? ''}
      </div>
      <div className="border-white/5 w-8 shrink-0 border-r pr-1 text-right opacity-20 select-none">
        {line.newLineNumber ?? ''}
      </div>
      <div className={`w-4 shrink-0 text-center opacity-40 select-none ${textColor}`}>{symbol}</div>
      <div className={`flex-1 px-1 break-all whitespace-pre-wrap ${textColor}`}>{renderContent()}</div>
    </div>
  );
}

