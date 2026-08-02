import { ListOrdered, ChevronUp, ChevronDown, X, Paperclip } from 'lucide-react';
import { useSessionStream } from '../../../../contexts/SessionContext';

export function QueuedMessagesPillStack() {
  const { queuedMessages, dequeueMessage, moveQueuedMessage } = useSessionStream();

  if (queuedMessages.length === 0) return null;

  return (
    <div className="bg-brand-mantle/95 border-border/30 animate-in fade-in slide-in-from-bottom-2 relative z-20 -mb-px flex w-full flex-col gap-2 rounded-t-xl border-x border-t px-4 py-2.5 shadow-md backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ListOrdered className="text-accent h-3.5 w-3.5" />
          <span className="text-text-main text-[13px] font-semibold tracking-normal">
            Queued prompts ({queuedMessages.length})
          </span>
        </div>
        <span className="text-text-muted text-[11px] font-medium opacity-70">
          Will execute in order
        </span>
      </div>

      <div className="flex max-h-36 flex-col gap-1.5 overflow-y-auto pr-0.5">
        {queuedMessages.map((msg, index) => (
          <div
            key={msg.id}
            className="group/pill border-border/40 bg-surface-secondary/60 hover:bg-surface-secondary hover:border-border/80 flex items-center justify-between gap-3 rounded-lg border px-3 py-1.5 transition-all"
          >
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <span className="bg-accent/15 text-accent shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] font-bold">
                #{String(index + 1)}
              </span>
              <span className="text-text-main truncate font-sans text-[13px]" title={msg.text}>
                {msg.text}
              </span>
              {msg.attachmentIds && msg.attachmentIds.length > 0 && (
                <span
                  className="text-text-muted bg-surface-tertiary border-border/30 inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[11px]"
                  title={`${String(msg.attachmentIds.length)} attachment(s)`}
                >
                  <Paperclip className="h-3 w-3" />
                  <span>{msg.attachmentIds.length}</span>
                </span>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1 opacity-80 group-hover/pill:opacity-100">
              <button
                type="button"
                disabled={index === 0}
                onClick={() => {
                  moveQueuedMessage(index, 'up');
                }}
                className="text-text-muted hover:text-text-main hover:bg-surface-tertiary cursor-pointer rounded p-1 transition-colors disabled:cursor-not-allowed disabled:opacity-20"
                title="Move up"
                aria-label="Move up in queue"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={index === queuedMessages.length - 1}
                onClick={() => {
                  moveQueuedMessage(index, 'down');
                }}
                className="text-text-muted hover:text-text-main hover:bg-surface-tertiary cursor-pointer rounded p-1 transition-colors disabled:cursor-not-allowed disabled:opacity-20"
                title="Move down"
                aria-label="Move down in queue"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  dequeueMessage(msg.id);
                }}
                className="ml-1 cursor-pointer rounded p-1 text-rose-400 transition-colors hover:bg-rose-500/10 hover:text-rose-300"
                title="Cancel prompt"
                aria-label="Cancel prompt"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
