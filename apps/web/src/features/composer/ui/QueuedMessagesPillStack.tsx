import { useState } from 'react';
import {
  ListOrdered,
  ChevronUp,
  ChevronDown,
  X,
  Paperclip,
  Pencil,
  RotateCcw,
  Play,
  AlertCircle,
} from 'lucide-react';
import { useSessionQueue } from '@/features/sessions';
import { IconButton, MessageEditor, Tooltip, Spinner } from '@agentctl/ui';
import { presentProviderError } from '@agentctl/shared';
import type { QueuedMessage } from '@/shared/stores/useMessageQueueStore';

interface MessageQueueProps {
  messages: QueuedMessage[];
  attention?: 'none' | 'approval' | 'delivery_uncertain' | 'error';
  pendingId?: string;
  onCancel: (id: string) => void;
  onMove: (index: number, direction: 'up' | 'down') => void;
  onRetry: (id: string) => void;
  onEdit: (id: string, text: string) => Promise<boolean>;
  onResume?: () => Promise<void | boolean>;
}

export function MessageQueue({
  messages,
  attention,
  pendingId,
  onCancel,
  onMove,
  onRetry,
  onEdit,
  onResume,
}: MessageQueueProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [editing, setEditing] = useState<QueuedMessage | null>(null);
  const entries = messages
    .map((message, queueIndex) => ({ message, queueIndex }))
    .filter(({ message }) => message.status !== 'sending' || message.waiting);
  const busy = pendingId !== undefined;
  const canMove = (index: number, direction: 'up' | 'down') => {
    const item = messages[index];
    const neighbor = messages[index + (direction === 'up' ? -1 : 1)];
    return (
      !busy &&
      !!neighbor &&
      !!item.accepted === !!neighbor.accepted &&
      [item, neighbor].every(
        (message) => message.status !== 'sending' && message.status !== 'unknown',
      )
    );
  };
  if (entries.length === 0 && !editing) return null;
  const editingUnavailable = !!editing && !entries.some(({ message }) => message.id === editing.id);
  const visibleEntries = editingUnavailable
    ? [...entries, { message: editing!, queueIndex: -1 }]
    : entries;
  const queueState =
    attention === 'delivery_uncertain'
      ? 'Delivery uncertain'
      : attention === 'error'
        ? 'Paused'
        : attention === 'approval'
          ? 'Awaiting approval'
          : undefined;

  return (
    <section
      aria-label="Message queue"
      className="border-border/30 bg-brand-mantle relative z-20 -mb-px w-full rounded-t-xl border-x border-t"
    >
      <div className="flex min-h-10 items-center gap-2 px-3 sm:px-4">
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand message queue' : 'Collapse message queue'}
          onClick={() => setCollapsed((value) => !value)}
          className="text-text-muted hover:text-text-main focus-visible:ring-accent flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded py-2 text-left text-xs focus-visible:ring-2 focus-visible:outline-none"
        >
          <ListOrdered aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          <span className="text-text-main font-medium">Queue</span>
          <span className="text-text-muted tabular-nums">{entries.length}</span>
          {queueState && (
            <span role="status" className="min-w-0 truncate text-[11px] text-amber-400">
              {queueState}
            </span>
          )}
          {collapsed ? (
            <ChevronUp aria-hidden="true" className="ml-auto h-3.5 w-3.5" />
          ) : (
            <ChevronDown aria-hidden="true" className="ml-auto h-3.5 w-3.5" />
          )}
        </button>
        {attention === 'error' && onResume && (
          <Tooltip content="Resume queue">
            <IconButton
              size="compact"
              type="button"
              aria-label="Resume queue"
              disabled={busy}
              onClick={() => void onResume()}
            >
              {pendingId === 'resume' ? (
                <Spinner aria-hidden="true" className="icon-compact" />
              ) : (
                <Play aria-hidden="true" className="h-3.5 w-3.5" />
              )}
            </IconButton>
          </Tooltip>
        )}
      </div>
      {attention === 'delivery_uncertain' && !collapsed && (
        <p role="status" className="text-text-muted px-3 pb-2 text-xs sm:px-4">
          Delivery is unconfirmed. The queue is paused.
        </p>
      )}
      {(!collapsed || editing) && (
        <ol className="custom-scrollbar divide-border/20 max-h-64 overflow-y-auto border-t border-inherit px-3 sm:px-4">
          {visibleEntries.map(({ message, queueIndex }, index) => (
            <li key={message.id} className="divide-border/20 border-b last:border-b-0">
              {editing?.id === message.id ? (
                <div className="py-2">
                  {editingUnavailable && (
                    <p role="status" className="text-text-muted mb-2 text-xs">
                      This message is no longer queued.
                    </p>
                  )}
                  <MessageEditor
                    key={message.id}
                    initialValue={editing.text}
                    label="Edit queued message"
                    onCancel={() => setEditing(null)}
                    onSubmit={(text) => (editingUnavailable ? false : onEdit(message.id, text))}
                  />
                </div>
              ) : (
                <div className="group/queue flex min-h-11 items-center gap-2 py-1.5">
                  <span
                    aria-hidden="true"
                    className="text-text-muted/60 w-4 shrink-0 text-center text-[11px] tabular-nums"
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className="text-text-main line-clamp-2 text-xs leading-relaxed [overflow-wrap:anywhere]"
                      title={message.text}
                    >
                      {message.text || 'Image attachment'}
                    </p>
                    {(message.status === 'failed' || message.status === 'unknown') && (
                      <p
                        role="status"
                        className="mt-0.5 flex items-start gap-1 text-[11px] [overflow-wrap:anywhere] text-amber-400"
                      >
                        <AlertCircle aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0" />
                        {message.status === 'failed'
                          ? message.error
                            ? presentProviderError(message.error).message
                            : 'Not sent'
                          : 'Delivery uncertain'}
                      </p>
                    )}
                  </div>
                  {!!message.attachmentIds?.length && (
                    <span
                      className="text-text-muted flex shrink-0 items-center gap-1 text-[11px]"
                      title={`${message.attachmentIds.length} attachments`}
                    >
                      <Paperclip aria-hidden="true" className="h-3 w-3" />
                      {message.attachmentIds.length}
                    </span>
                  )}
                  <div className="flex shrink-0 items-center gap-0.5">
                    {message.status === 'sending' || pendingId === message.id ? (
                      <Spinner
                        label="Updating queued message"
                        className="text-text-muted icon-compact mx-1.5"
                      />
                    ) : null}
                    {message.status === 'failed' && (
                      <Tooltip content="Retry message">
                        <IconButton
                          type="button"
                          size="compact"
                          aria-label="Retry queued message"
                          title={
                            message.error ? presentProviderError(message.error).message : undefined
                          }
                          disabled={busy}
                          onClick={() => onRetry(message.id)}
                        >
                          <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
                        </IconButton>
                      </Tooltip>
                    )}
                    {message.status !== 'failed' && message.status !== 'unknown' && (
                      <Tooltip content="Edit message">
                        <IconButton
                          type="button"
                          size="compact"
                          aria-label="Edit queued message"
                          disabled={busy || message.status === 'sending'}
                          onClick={() => {
                            setEditing(message);
                            setCollapsed(false);
                          }}
                        >
                          <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                        </IconButton>
                      </Tooltip>
                    )}
                    <Tooltip content="Move up">
                      <IconButton
                        type="button"
                        size="compact"
                        aria-label="Move up in queue"
                        disabled={!canMove(queueIndex, 'up')}
                        onClick={() => onMove(queueIndex, 'up')}
                      >
                        <ChevronUp aria-hidden="true" className="h-3.5 w-3.5" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip content="Move down">
                      <IconButton
                        type="button"
                        size="compact"
                        aria-label="Move down in queue"
                        disabled={!canMove(queueIndex, 'down')}
                        onClick={() => onMove(queueIndex, 'down')}
                      >
                        <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip content="Remove from queue">
                      <IconButton
                        type="button"
                        size="compact"
                        aria-label="Cancel prompt"
                        disabled={busy || message.status === 'sending'}
                        onClick={() => onCancel(message.id)}
                      >
                        <X aria-hidden="true" className="h-3.5 w-3.5" />
                      </IconButton>
                    </Tooltip>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function QueuedMessagesPillStack() {
  const queue = useSessionQueue();
  return (
    <MessageQueue
      messages={queue.queuedMessages}
      attention={queue.queueAttention}
      pendingId={queue.queuePendingId}
      onCancel={queue.dequeueMessage}
      onMove={queue.moveQueuedMessage}
      onRetry={queue.retryQueuedMessage}
      onEdit={queue.editQueuedMessage}
      onResume={queue.resumeQueue}
    />
  );
}
