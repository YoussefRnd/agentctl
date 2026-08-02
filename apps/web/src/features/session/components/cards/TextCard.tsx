import { memo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Sparkles, RotateCcw, Copy, Check, Pencil } from 'lucide-react';
import { RewindMenu } from '../RewindMenu';
import type { RewindMode } from '../RewindMenu';
import { useSession } from '../../../../contexts/SessionContext';
import { StreamingDots } from '@/shared/StreamingDots';
import { Popover, PopoverTrigger, PopoverContent, Card } from '@agentctl/ui';
import { MarkdownCodeBlock } from './MarkdownCodeBlock';

type Role = 'provider' | 'user';

interface TextCardProps {
  content: string;
  variant?: Role;
  isStreaming?: boolean;
  attachments?: {
    attachmentId: string;
    mimeType: string;
    filename: string;
    sizeBytes: number;
  }[];
  eventId?: number;
  hasGitRepo?: boolean;
  isSessionRunning?: boolean;
  onRewind?: (eventId: number, mode: RewindMode) => void;
}

export const TextCard = memo(function TextCard({
  content,
  variant = 'provider',
  isStreaming = false,
  attachments,
  eventId,
  hasGitRepo,
  isSessionRunning,
  onRewind,
}: TextCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const { sessionId } = useSession();

  const handleCopy = () => {
    void navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  const handleEdit = () => {
    window.dispatchEvent(new CustomEvent('agentctl:edit-prompt', { detail: content }));
  };

  if (variant === 'user') {
    return (
      <div data-font-ctx="chat" className="group/card flex justify-end py-3">
        <div className="flex max-w-[85%] flex-col items-end gap-2 sm:max-w-[75%]">
          {attachments && attachments.length > 0 && (
            <div className="flex flex-wrap justify-end gap-2">
              {attachments.map((att) => (
                <div
                  key={att.attachmentId}
                  className="group/img border-border bg-surface-secondary hover:border-accent/30 relative overflow-hidden rounded-lg border transition-all duration-200"
                >
                  <img
                    src={`/api/sessions/${sessionId}/attachments/${att.attachmentId}`}
                    alt={att.filename}
                    className="max-h-60 max-w-full rounded-lg object-contain"
                  />
                </div>
              ))}
            </div>
          )}
          <div className="group/bubble relative flex w-full justify-end">
            {content && (
              <Card className="text-text-main relative px-4 py-3 text-[14px] leading-relaxed">
                {content}
              </Card>
            )}

            {/* Subtle hover quick-action bar */}
            <div className="border-border/40 bg-surface-primary/95 absolute -top-3 right-2 z-10 flex items-center gap-0.5 rounded-md border p-1 opacity-0 shadow-sm backdrop-blur-sm transition-opacity duration-200 group-hover/bubble:opacity-100 group-hover/card:opacity-100 focus-within:opacity-100">
              <button
                type="button"
                onClick={handleCopy}
                className="text-text-muted hover:text-text-main hover:bg-surface-secondary flex h-6 cursor-pointer items-center gap-1.5 rounded px-2 text-xs font-medium transition-colors"
                title="Copy text"
                aria-label="Copy text"
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-400" />
                    <span className="text-[11px] text-emerald-400">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    <span className="text-[11px]">Copy</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleEdit}
                className="text-text-muted hover:text-text-main hover:bg-surface-secondary flex h-6 cursor-pointer items-center gap-1.5 rounded px-2 text-xs font-medium transition-colors"
                title="Edit prompt"
                aria-label="Edit prompt"
              >
                <Pencil className="h-3 w-3" />
                <span className="text-[11px]">Edit</span>
              </button>

              {eventId && onRewind && (
                <Popover open={showMenu} onOpenChange={setShowMenu}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="text-text-muted hover:text-text-main hover:bg-surface-secondary flex h-6 cursor-pointer items-center gap-1.5 rounded px-2 text-xs font-medium transition-colors"
                      aria-label="Rewind or fork options"
                      title="Rewind or fork options"
                    >
                      <RotateCcw className="h-3 w-3" />
                      <span className="text-[11px]">Rewind</span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    side="bottom"
                    sideOffset={4}
                    className="w-[260px] overflow-hidden p-0"
                  >
                    <RewindMenu
                      eventId={eventId}
                      hasGitRepo={hasGitRepo ?? false}
                      isSessionRunning={isSessionRunning ?? false}
                      onRewind={onRewind}
                      onClose={() => {
                        setShowMenu(false);
                      }}
                    />
                  </PopoverContent>
                </Popover>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // provider (default)
  return (
    <div data-font-ctx="chat" className="group/provider relative py-3">
      <div className="flex items-start gap-3">
        <div className="mt-1 shrink-0">
          <div
            className={`border-border bg-surface-secondary/50 flex h-8 w-8 items-center justify-center rounded-lg border transition-all duration-300 ${
              isStreaming
                ? 'border-accent/40 bg-accent/5'
                : 'group-hover/provider:border-border-hover'
            }`}
          >
            <Sparkles
              className={`h-4 w-4 ${isStreaming ? 'text-accent animate-pulse' : 'text-text-muted'}`}
            />
          </div>
        </div>

        <div className="group/provider-content relative min-w-0 flex-1">
          {/* Subtle hover quick-action bar for provider text */}
          <div className="border-border/40 bg-surface-primary/95 absolute -top-2 right-0 z-10 flex items-center gap-0.5 rounded-md border p-1 opacity-0 shadow-sm backdrop-blur-sm transition-opacity duration-200 group-hover/provider:opacity-100 focus-within:opacity-100">
            <button
              type="button"
              onClick={handleCopy}
              className="text-text-muted hover:text-text-main hover:bg-surface-secondary flex h-6 cursor-pointer items-center gap-1.5 rounded px-2 text-xs font-medium transition-colors"
              title="Copy text"
              aria-label="Copy text"
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3 text-emerald-400" />
                  <span className="text-[11px] text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" />
                  <span className="text-[11px]">Copy</span>
                </>
              )}
            </button>

            {eventId && onRewind && (
              <Popover open={showMenu} onOpenChange={setShowMenu}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="text-text-muted hover:text-text-main hover:bg-surface-secondary flex h-6 cursor-pointer items-center gap-1.5 rounded px-2 text-xs font-medium transition-colors"
                    aria-label="Rewind or fork options"
                    title="Rewind or fork options"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span className="text-[11px]">Rewind</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  side="bottom"
                  sideOffset={4}
                  className="w-[260px] overflow-hidden p-0"
                >
                  <RewindMenu
                    eventId={eventId}
                    hasGitRepo={hasGitRepo ?? false}
                    isSessionRunning={isSessionRunning ?? false}
                    onRewind={onRewind}
                    onClose={() => {
                      setShowMenu(false);
                    }}
                  />
                </PopoverContent>
              </Popover>
            )}
          </div>

          <div className="prose prose-invert prose-pre:bg-surface-secondary/50 prose-pre:border prose-pre:border-border prose-pre:rounded-md text-text-main/90 selection:bg-accent/30 max-w-none text-[15px] leading-7 tracking-normal">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={{ pre: MarkdownCodeBlock }}
            >
              {content}
            </ReactMarkdown>
            {isStreaming && <StreamingDots />}
          </div>
        </div>
      </div>
    </div>
  );
});
