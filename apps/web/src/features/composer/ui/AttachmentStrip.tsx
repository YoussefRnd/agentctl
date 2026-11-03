import { RefreshCw, X, AlertCircle } from 'lucide-react';
import type { PendingAttachment } from '../model/useAttachments';
import { Button, IconButton, ImagePreview, Spinner } from '@agentctl/ui';

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
      className="flex items-center gap-2.5 overflow-x-auto px-3 py-2.5 sm:px-5"
      style={{ scrollbarWidth: 'none' }}
    >
      {attachments.map((attachment) => (
        <ImagePreview
          key={attachment.localId}
          src={attachment.objectUrl}
          filename={attachment.file.name}
          previewable={attachment.state === 'ready'}
          className="group border-border/40 bg-surface-secondary/40 relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border shadow-sm transition-colors sm:h-18 sm:w-18"
          imageClassName="object-cover transition-transform duration-200 group-hover:scale-105"
        >
          {/* Bottom subtle gradient for text readability */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-black/80 to-transparent" />

          {/* Uploading: circular spinner overlay */}
          {attachment.state === 'uploading' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/60 backdrop-blur-xs">
              <Spinner aria-hidden="true" className="text-accent icon-default" />
              <span className="font-mono text-[9px] font-bold text-white">
                {attachment.progress}%
              </span>
            </div>
          )}

          {/* Error: dark frosted overlay + retry & remove controls */}
          {attachment.state === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 border border-red-500/40 bg-black/80 p-1 backdrop-blur-xs">
              <IconButton
                onClick={() => {
                  onRemove(attachment.localId);
                }}
                size="sm"
                className="hover:bg-surface/60 absolute top-0.5 right-0.5 h-5 w-5 rounded-full p-0"
                aria-label="Remove failed attachment"
                title="Remove attachment"
              >
                <X className="h-3 w-3" />
              </IconButton>

              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  onRetry(attachment.localId);
                }}
                className="h-6 gap-1 border border-red-500/30 bg-red-500/20 px-2 text-[9.5px] text-red-300 hover:bg-red-500/30"
                aria-label="Retry upload"
                title="Retry upload"
              >
                <RefreshCw className="h-2.5 w-2.5" />
                <span>Retry</span>
              </Button>

              <div className="flex items-center gap-0.5 text-[8px] font-medium text-red-400">
                <AlertCircle className="h-2.5 w-2.5" />
                <span>Failed</span>
              </div>
            </div>
          )}

          {/* Ready: remove button on top right */}
          {attachment.state === 'ready' && (
            <IconButton
              onClick={() => {
                onRemove(attachment.localId);
              }}
              size="sm"
              className="pointer-events-none absolute top-1 right-1 h-6 w-6 rounded-full bg-black/70 p-0 text-white/80 opacity-0 shadow-sm backdrop-blur-xs transition-[opacity,background-color,color,transform] duration-150 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 hover:bg-black hover:text-white [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
              aria-label="Remove attachment"
            >
              <X className="h-3.5 w-3.5" />
            </IconButton>
          )}

          {/* File size badge — bottom-right */}
          {attachment.state !== 'error' && (
            <span className="absolute right-1 bottom-1 rounded bg-black/60 px-1 py-0.5 font-mono text-[8.5px] leading-tight font-medium text-white/90 shadow-xs backdrop-blur-xs">
              {formatSize(attachment.file.size)}
            </span>
          )}
        </ImagePreview>
      ))}
    </div>
  );
}
