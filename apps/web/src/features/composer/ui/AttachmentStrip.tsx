import { RefreshCw, X, Loader2, AlertCircle } from 'lucide-react';
import type { PendingAttachment } from '../model/useAttachments';

interface AttachmentStripProps {
  attachments: PendingAttachment[];
  onRemove: (localId: string) => void;
  onRetry: (localId: string) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes.toString()} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentStrip({ attachments, onRemove, onRetry }: AttachmentStripProps) {
  if (attachments.length === 0) return null;

  return (
    <div
      className="flex items-center gap-2.5 overflow-x-auto px-5 py-2.5"
      style={{ scrollbarWidth: 'none' }}
    >
      {attachments.map((attachment) => (
        <div
          key={attachment.localId}
          className="group border-border/40 bg-surface-secondary/40 relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border shadow-sm transition-colors sm:h-18 sm:w-18"
        >
          {/* Base image thumbnail */}
          <img
            src={attachment.objectUrl}
            alt={attachment.file.name}
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
          />

          {/* Bottom subtle gradient for text readability */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-black/80 to-transparent" />

          {/* Uploading: circular spinner overlay */}
          {attachment.state === 'uploading' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/60 backdrop-blur-xs">
              <Loader2 className="text-accent h-4 w-4 animate-spin" />
              <span className="font-mono text-[9px] font-bold text-white">
                {attachment.progress}%
              </span>
            </div>
          )}

          {/* Error: dark frosted overlay + retry & remove controls */}
          {attachment.state === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 border border-red-500/40 bg-black/80 p-1 backdrop-blur-xs">
              <button
                type="button"
                onClick={() => {
                  onRemove(attachment.localId);
                }}
                className="hover:bg-surface/60 text-text-muted hover:text-text-main absolute top-1 right-1 flex h-4 w-4 cursor-pointer items-center justify-center rounded-full transition-colors"
                aria-label="Remove failed attachment"
                title="Remove attachment"
              >
                <X className="h-3 w-3" />
              </button>

              <button
                type="button"
                onClick={() => {
                  onRetry(attachment.localId);
                }}
                className="flex cursor-pointer items-center gap-1 rounded-md border border-red-500/30 bg-red-500/20 px-2 py-0.5 text-[9.5px] font-bold text-red-300 transition-colors hover:bg-red-500/30"
                aria-label="Retry upload"
                title="Retry upload"
              >
                <RefreshCw className="h-2.5 w-2.5" />
                <span>Retry</span>
              </button>

              <div className="flex items-center gap-0.5 text-[8px] font-medium text-red-400">
                <AlertCircle className="h-2.5 w-2.5" />
                <span>Failed</span>
              </div>
            </div>
          )}

          {/* Ready: remove button on top right */}
          {attachment.state === 'ready' && (
            <button
              type="button"
              onClick={() => {
                onRemove(attachment.localId);
              }}
              className="absolute top-1 right-1 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-black/70 text-white/80 opacity-0 shadow-sm backdrop-blur-xs transition-opacity duration-150 group-hover:opacity-100 hover:bg-black hover:text-white"
              aria-label="Remove attachment"
            >
              <X className="h-3 w-3" />
            </button>
          )}

          {/* File size badge — bottom-right */}
          {attachment.state !== 'error' && (
            <span className="absolute right-1 bottom-1 rounded bg-black/60 px-1 py-0.5 font-mono text-[8.5px] leading-tight font-medium text-white/90 shadow-xs backdrop-blur-xs">
              {formatSize(attachment.file.size)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
