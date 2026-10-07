import { ListOrdered, ChevronUp, ChevronDown, X, Paperclip } from 'lucide-react';
import { useSessionQueue } from '@/features/sessions';
import { IconButton } from '@agentctl/ui';

export function QueuedMessagesPillStack() {
  const {
    queuedMessages,
    dequeueMessage,
    moveQueuedMessage,
    retryQueuedMessage,
    queueAttention,
    resumeQueue,
  } = useSessionQueue();
  // The outbox also tracks immediate sends until acknowledgement. Only waiting
  // and failed messages belong in the queue UI; keep their original move indices.
  const visibleEntries = queuedMessages
    .map((message, queueIndex) => ({ message, queueIndex }))
    .filter(({ message }) => message.status !== 'sending');

  if (visibleEntries.length === 0) return null;

  return (
    <div className="bg-brand-mantle/95 border-border/30 animate-in fade-in slide-in-from-bottom-2 relative z-20 -mb-px flex w-full flex-col gap-2 rounded-t-xl border-x border-t px-3 py-2.5 shadow-md backdrop-blur-xl sm:px-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ListOrdered className="text-accent h-3.5 w-3.5" />
          <span className="text-text-main text-[13px] font-semibold tracking-normal">
            Queued prompts ({visibleEntries.length})
          </span>
        </div>
        <span className="text-text-muted hidden text-[11px] font-medium opacity-70 sm:inline">
          Will execute in order
        </span>
      </div>

      {queueAttention === 'delivery_uncertain' && (
        <p className="text-text-muted text-xs">
          Check the provider before cancelling the uncertain message and resuming.
        </p>
      )}
      {queueAttention === 'error' && (
        <button type="button" className="text-accent text-xs" onClick={() => void resumeQueue?.()}>
          Queue paused · Resume
        </button>
      )}
      <div className="flex max-h-36 flex-col gap-1.5 overflow-y-auto pr-0.5">
        {visibleEntries.map(({ message: msg, queueIndex }, index) => (
          <div
            key={msg.id}
            className="group/pill border-border/40 bg-surface-secondary/60 hover:bg-surface-secondary hover:border-border/80 flex items-center justify-between gap-3 rounded-lg border px-3 py-1.5 transition-colors"
          >
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <span className="bg-accent/15 text-accent shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] font-bold">
                #{String(index + 1)}
              </span>
              <span className="text-text-main truncate font-sans text-[13px]" title={msg.text}>
                {msg.text}
                {msg.status === 'failed' && ' · Failed'}
                {msg.status === 'unknown' && ' · Delivery uncertain'}
              </span>
              {msg.attachmentIds && msg.attachmentIds.length > 0 && (
                <span
                  className="text-text-muted bg-surface-tertiary border-border/30 inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[11px]"
                  title={`${String(msg.attachmentIds.length)} attachment(s)`}
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  <span>{msg.attachmentIds.length}</span>
                </span>
              )}
            </div>

            {msg.status === 'failed' && (
              <button
                type="button"
                className="text-accent text-xs"
                title={msg.error}
                onClick={() => retryQueuedMessage(msg.id)}
              >
                Retry
              </button>
            )}
            <div className="flex shrink-0 items-center gap-0.5 opacity-80 transition-opacity group-focus-within/pill:opacity-100 group-hover/pill:opacity-100">
              <IconButton
                disabled={
                  queueIndex === 0 ||
                  msg.status === 'unknown' ||
                  (!msg.accepted && queuedMessages[queueIndex - 1]?.status === 'sending')
                }
                onClick={() => {
                  moveQueuedMessage(queueIndex, 'up');
                }}
                size="sm"
                className="hover:bg-surface-tertiary disabled:opacity-20"
                title="Move up"
                aria-label="Move up in queue"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton
                disabled={
                  queueIndex === queuedMessages.length - 1 ||
                  msg.status === 'unknown' ||
                  (!msg.accepted && queuedMessages[queueIndex + 1]?.status === 'sending')
                }
                onClick={() => {
                  moveQueuedMessage(queueIndex, 'down');
                }}
                size="sm"
                className="hover:bg-surface-tertiary disabled:opacity-20"
                title="Move down"
                aria-label="Move down in queue"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton
                onClick={() => {
                  dequeueMessage(msg.id);
                }}
                size="sm"
                className="ml-0.5 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
                title="Cancel prompt"
                aria-label="Cancel prompt"
              >
                <X className="h-3.5 w-3.5" />
              </IconButton>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
