import { memo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Sparkles, RotateCcw, Copy, Check, Pencil } from 'lucide-react';
import { RewindMenu } from '../RewindMenu';
import type { RewindMode } from '../RewindMenu';
import { useSession } from '../../../../contexts/SessionContext';
import { StreamingDots } from '@/shared';
import { Popover, PopoverTrigger, PopoverContent, Card, Tooltip } from '@agentctl/ui';
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
      <div data-font-ctx="chat" className="group/card flex justify-end py-2">
        <div className="flex max-w-[85%] flex-col items-end gap-1.5 sm:max-w-[75%]">
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
          <div className="group/bubble relative flex w-full flex-col items-end">
            {content && (
              <Card className="text-text-main relative px-4 py-3 text-[14px] leading-relaxed shadow-sm">
                {content}
              </Card>
            )}

            {/* Quick action bar anchored cleanly below user message bubble */}
            <div className="mt-1 flex items-center gap-0.5 opacity-0 transition-opacity duration-200 group-hover/card:opacity-100 focus-within:opacity-100">
              <Tooltip content={copied ? 'Copied to clipboard' : 'Copy message'}>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="text-text-muted hover:text-text-main hover:bg-surface-secondary/80 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-colors"
                  aria-label="Copy message"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </Tooltip>

              <Tooltip content="Edit prompt">
                <button
                  type="button"
                  onClick={handleEdit}
                  className="text-text-muted hover:text-text-main hover:bg-surface-secondary/80 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-colors"
                  aria-label="Edit prompt"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </Tooltip>

              {eventId && onRewind && (
                <Popover open={showMenu} onOpenChange={setShowMenu}>
                  <Tooltip content="Rewind or fork session">
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="text-text-muted hover:text-text-main hover:bg-surface-secondary/80 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-colors"
                        aria-label="Rewind or fork options"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                    </PopoverTrigger>
                  </Tooltip>
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
          {/* Quick-action toolbar for provider response */}
          <div className="mb-1 flex items-center justify-end gap-0.5 opacity-0 transition-opacity duration-200 group-hover/provider:opacity-100 focus-within:opacity-100">
            <Tooltip content={copied ? 'Copied to clipboard' : 'Copy response'}>
              <button
                type="button"
                onClick={handleCopy}
                className="text-text-muted hover:text-text-main hover:bg-surface-secondary/80 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-colors"
                aria-label="Copy response"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </Tooltip>

            {eventId && onRewind && (
              <Popover open={showMenu} onOpenChange={setShowMenu}>
                <Tooltip content="Rewind or fork session">
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="text-text-muted hover:text-text-main hover:bg-surface-secondary/80 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-colors"
                      aria-label="Rewind or fork options"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                  </PopoverTrigger>
                </Tooltip>
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
