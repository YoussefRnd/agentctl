import { memo, useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { RotateCcw, Copy, Check, Pencil } from 'lucide-react';
import { RewindMenu } from '../RewindMenu';
import type { RewindMode } from '../RewindMenu';
import { useSession } from '../../../../contexts/SessionContext';
import { StreamingDots } from '@/shared';
import { Popover, PopoverTrigger, PopoverContent, Card, Tooltip } from '@agentctl/ui';
import { MarkdownCodeBlock } from './MarkdownCodeBlock';
import { formatShortcut } from '../../../../shared/lib/platform';
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
      <div data-font-ctx="chat" className="group/card flex justify-end py-2">
        <div className="flex max-w-[85%] flex-col items-end gap-1.5 sm:max-w-[75%]">
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
          <div className="group/bubble relative flex w-full flex-col items-end">
            {isEditing ? (
              <div className="border-border/70 bg-surface/90 focus-within:border-accent/50 focus-within:ring-accent/20 w-full min-w-[280px] rounded-2xl border p-3 shadow-lg backdrop-blur-md transition-colors focus-within:ring-1 sm:min-w-[380px]">
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
                <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-white/5 pt-2">
                  <span className="text-text-muted/40 hidden text-[11px] select-none sm:inline">
                    Esc to cancel • {formatShortcut('Enter')} to submit
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCancelEdit}
                      className="text-text-muted hover:text-text-main hover:bg-surface-secondary/60 cursor-pointer rounded-lg px-2.5 py-1 text-xs font-medium transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveEdit}
                      disabled={!draftContent.trim()}
                      className="bg-accent text-brand-crust hover:bg-accent/90 cursor-pointer rounded-lg px-3 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Save &amp; Submit
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {parsed.prompt ? (
                  <Card className="text-text-main relative px-4 py-3 leading-relaxed shadow-sm">
                    <div className="prose prose-invert prose-sm max-w-none leading-relaxed break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          pre: MarkdownCodeBlock,
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
                      onClick={handleStartEdit}
                      className="text-text-muted hover:text-text-main hover:bg-surface-secondary/80 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-colors"
                      aria-label="Edit prompt"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </Tooltip>

                  {eventId && onRewind && (
                    <Popover open={showMenu} onOpenChange={setShowMenu}>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="text-text-muted hover:text-text-main hover:bg-surface-secondary/80 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-colors"
                          aria-label="Rewind or fork options"
                          title="Rewind or fork session"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
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
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="text-text-muted hover:text-text-main hover:bg-surface-secondary/80 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-colors"
                  aria-label="Rewind or fork options"
                  title="Rewind or fork session"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
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
  );
});
