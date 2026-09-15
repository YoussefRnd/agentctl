import { memo, useState } from 'react';
import { FileCode, Folder, GitBranch, ChevronDown, ChevronUp } from 'lucide-react';
import type { ContextAttachment } from '../../lib/userMessageParser';

interface ContextAttachmentChipProps {
  attachment: ContextAttachment;
}

export const ContextAttachmentChip = memo(function ContextAttachmentChip({
  attachment,
}: ContextAttachmentChipProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const getIcon = () => {
    switch (attachment.type) {
      case 'git':
        return <GitBranch className="text-accent h-3.5 w-3.5" />;
      case 'folder':
        return <Folder className="text-brand-yellow h-3.5 w-3.5" />;
      default:
        return <FileCode className="text-brand-blue h-3.5 w-3.5" />;
    }
  };

  return (
    <div className="bg-brand-mantle/60 w-full max-w-full overflow-hidden rounded-xl border border-white/10 text-xs shadow-sm transition-all duration-200">
      {/* Header / Pill Row */}
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="flex w-full cursor-pointer items-center justify-between gap-2.5 px-3 py-2 text-left transition-colors hover:bg-white/5 active:scale-[0.99]"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex-shrink-0">{getIcon()}</span>
          <span className="text-text-main truncate font-mono text-[11px] font-medium">
            {attachment.title}
          </span>
        </div>

        <span className="text-text-muted flex h-5 w-5 flex-shrink-0 items-center justify-center">
          {isExpanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </span>
      </button>

      {/* Expanded Preview Drawer */}
      {isExpanded && (
        <div className="bg-brand-crust/80 border-t border-white/5 p-3">
          <pre className="text-text-muted selection:bg-accent/20 max-h-64 overflow-x-auto overflow-y-auto font-mono text-[11px] leading-relaxed">
            <code>{attachment.content}</code>
          </pre>
        </div>
      )}
    </div>
  );
});
