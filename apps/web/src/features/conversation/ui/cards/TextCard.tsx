import { memo, useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { RotateCcw, Copy, Check, Pencil } from 'lucide-react';
import { RewindMenu, useSession, type RewindMode } from '@/features/sessions';
import { StreamingDots } from '@/shared';
import {
  Button,
  Card,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
} from '@agentctl/ui';
import { MarkdownCodeBlock } from './MarkdownCodeBlock';
import { MarkdownTable } from './MarkdownTable';
import { formatShortcut } from '@/shared/lib/platform';
import { parseUserMessageContent } from '../../lib/userMessageParser';
import { ContextAttachmentChip } from './ContextAttachmentChip';

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
  deliveryStatus?: 'queued' | 'sending' | 'accepted' | 'failed' | 'unknown' | 'cancelled';
  deliveryError?: string;
  onRetry?: (eventId: number) => void;
  hasGitRepo?: boolean;
  onRewind?: (eventId: number, mode: RewindMode) => void;
  onEditSubmit?: (eventId: number, newContent: string) => void;
}

function autoFocusTextarea(textarea: HTMLTextAreaElement | null) {
  if (textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = `${String(Math.min(textarea.scrollHeight, 360))}px`;
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
  }
}

function renderTextWithMentions(node: React.ReactNode): React.ReactNode {
  if (typeof node !== 'string') {
    if (Array.isArray(node)) {
      return node.map((child, i) => <span key={i}>{renderTextWithMentions(child)}</span>);
    }
    return node;
  }

  const parts = node.split(/(@[a-zA-Z0-9_./-]+)/g);
  if (parts.length === 1) return node;

  return parts.map((part, index) => {
    if (part.startsWith('@') && part.length > 1) {
      return (
        <span
          key={index}
          className="border-accent/25 bg-accent/15 py-0.2 text-accent selection:bg-accent/30 inline-flex items-center rounded border px-1.5 font-mono text-[11px] font-medium"
        >
          {part}
        </span>
      );
    }
    return part;
  });
}

export const TextCard = memo(function TextCard({
  content,
  variant = 'provider',
  isStreaming = false,
  attachments,
  eventId,
  deliveryStatus,
  deliveryError,
  onRetry,
  hasGitRepo,
  onRewind,
  onEditSubmit,
}: TextCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const parsed = useMemo(() => parseUserMessageContent(content), [content]);
  const [draftContent, setDraftContent] = useState(parsed.prompt || content);
  const { sessionId } = useSession();

  const handleCopy = () => {
    void navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  const handleStartEdit = () => {
    setDraftContent(parsed.prompt || content);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setDraftContent(parsed.prompt || content);
  };

  const handleSaveEdit = () => {
    const trimmed = draftContent.trim();
    if (!trimmed) return;
    setIsEditing(false);
    if (eventId && onEditSubmit) {
      const attachmentIndex = content.indexOf('### Context Attachment:');
      const fullUpdatedContent =
        attachmentIndex !== -1 ? `${trimmed}\n\n${content.slice(attachmentIndex)}` : trimmed;
      onEditSubmit(eventId, fullUpdatedContent);
    }
  };

  if (variant === 'user') {
    return (
      <div data-font-ctx="chat" className="group/card flex min-w-0 justify-end py-2">
        <div className="flex max-w-[85%] min-w-0 flex-col items-end gap-1.5 sm:max-w-[75%]">
          {attachments && attachments.length > 0 && (
            <div className="flex flex-wrap justify-end gap-2">
              {attachments.map((att) => (
                <div
                  key={att.attachmentId}
                  className="group/img border-border bg-surface-secondary hover:border-accent/30 relative overflow-hidden rounded-lg border transition-colors duration-200"
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
          <div className="group/bubble relative flex w-full min-w-0 flex-col items-end">
            {isEditing ? (
              <div className="border-border/70 bg-surface/90 focus-within:border-accent/50 focus-within:ring-accent/20 w-full min-w-0 rounded-lg border p-3 shadow-lg backdrop-blur-md transition-colors focus-within:ring-1">
                <textarea
                  ref={autoFocusTextarea}
                  value={draftContent}
                  aria-label="Edit message prompt"
                  onChange={(e) => {
                    setDraftContent(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = `${String(Math.min(e.target.scrollHeight, 360))}px`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      handleCancelEdit();
                    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleSaveEdit();
                    }
                  }}
                  rows={Math.max(2, Math.min(8, draftContent.split('\n').length))}
                  className="text-text-main placeholder:text-text-muted/40 max-h-[360px] w-full resize-none bg-transparent leading-relaxed outline-none"
                  placeholder="Edit your prompt..."
                />
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-2">
                  <span className="text-text-muted/40 hidden text-[11px] select-none sm:inline">
                    Esc to cancel • {formatShortcut('Enter')} to submit
                  </span>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCancelEdit}
                      className="h-7 px-2.5 text-xs"
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSaveEdit}
                      disabled={!draftContent.trim()}
                      className="h-7 px-3 text-xs"
                    >
                      Save &amp; Submit
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {parsed.prompt ? (
                  <Card className="text-text-main relative max-w-full px-4 py-3 leading-relaxed shadow-sm">
                    <div className="prose prose-invert prose-sm max-w-none leading-relaxed break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          pre: MarkdownCodeBlock,
                          table: MarkdownTable,
                          p({ children }) {
                            return (
                              <p className="mb-1.5 last:mb-0">{renderTextWithMentions(children)}</p>
                            );
                          },
                        }}
                      >
                        {parsed.prompt}
                      </ReactMarkdown>
                    </div>
                  </Card>
                ) : null}

                {/* Clean context attachment badges for existing or dynamic attachments */}
                {parsed.attachments.length > 0 && (
                  <div className="mt-2 flex w-full flex-col gap-1.5">
                    {parsed.attachments.map((att) => (
                      <ContextAttachmentChip key={att.id} attachment={att} />
                    ))}
                  </div>
                )}

                {['queued', 'unknown', 'cancelled'].includes(deliveryStatus ?? '') && (
                  <div role="status" className="text-text-muted mt-2 text-xs">
                    {deliveryStatus === 'queued'
                      ? 'Queued on the server'
                      : deliveryStatus === 'cancelled'
                        ? 'Message cancelled'
                        : `Delivery uncertain: ${deliveryError ?? 'The connection was interrupted. Check the provider before resending.'}`}
                  </div>
                )}
                {deliveryStatus === 'failed' && (
                  <div className="mt-2 flex max-w-full flex-wrap items-center gap-2 text-xs text-rose-400">
                    <span role="status" className="min-w-0 [overflow-wrap:anywhere]">
                      Message not sent{deliveryError ? `: ${deliveryError}` : ''}
                    </span>
                    {eventId !== undefined && eventId < 0 && onRetry && (
                      <Button variant="ghost" size="sm" onClick={() => onRetry(eventId)}>
                        Retry
                      </Button>
                    )}
                  </div>
                )}

                {/* Quick action bar anchored cleanly below user message bubble */}
                <div className="pointer-events-none mt-1 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-focus-within/card:pointer-events-auto group-focus-within/card:opacity-100 group-hover/card:pointer-events-auto group-hover/card:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
                  <Tooltip content={copied ? 'Copied to clipboard' : 'Copy message'}>
                    <IconButton
                      size="compact"
                      onClick={handleCopy}
                      className="hover:bg-surface-secondary/80"
                      aria-label="Copy message"
                    >
                      {copied ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </IconButton>
                  </Tooltip>

                  {eventId !== undefined && eventId > 0 && (
                    <Tooltip content="Edit prompt">
                      <IconButton
                        size="compact"
                        onClick={handleStartEdit}
                        className="hover:bg-surface-secondary/80"
                        aria-label="Edit prompt"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </IconButton>
                    </Tooltip>
                  )}

                  {eventId !== undefined && eventId > 0 && onRewind && (
                    <Popover open={showMenu} onOpenChange={setShowMenu}>
                      <PopoverTrigger asChild>
                        <IconButton
                          size="compact"
                          className="hover:bg-surface-secondary/80"
                          aria-label="Rewind or fork options"
                          title="Rewind or fork session"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </IconButton>
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
                          onRewind={onRewind}
                          onClose={() => {
                            setShowMenu(false);
                          }}
                        />
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // provider (default)
  return (
    <div data-font-ctx="chat" className="group/provider relative py-3">
      <div className="group/provider-content relative min-w-0 flex-1">
        {/* Quick-action toolbar for provider response */}
        <div className="pointer-events-none mb-1 flex items-center justify-end gap-0.5 opacity-0 transition-opacity duration-150 group-focus-within/provider:pointer-events-auto group-focus-within/provider:opacity-100 group-hover/provider:pointer-events-auto group-hover/provider:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
          <Tooltip content={copied ? 'Copied to clipboard' : 'Copy response'}>
            <IconButton
              size="compact"
              onClick={handleCopy}
              className="hover:bg-surface-secondary/80"
              aria-label="Copy response"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </IconButton>
          </Tooltip>

          {eventId && onRewind && (
            <Popover open={showMenu} onOpenChange={setShowMenu}>
              <PopoverTrigger asChild>
                <IconButton
                  size="compact"
                  className="hover:bg-surface-secondary/80"
                  aria-label="Rewind or fork options"
                  title="Rewind or fork session"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </IconButton>
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
            components={{ pre: MarkdownCodeBlock, table: MarkdownTable }}
          >
            {content}
          </ReactMarkdown>
          {isStreaming && <StreamingDots />}
        </div>
      </div>
    </div>
  );
});
