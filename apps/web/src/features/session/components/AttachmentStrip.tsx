import { RefreshCw, X } from 'lucide-react';

import type { PendingAttachment } from '../../../hooks/useAttachments';

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
      className="flex items-center gap-2 overflow-x-auto px-4 py-2"
      style={{ scrollbarWidth: 'none' }}
    >
      {attachments.map((attachment) => (
        <div key={attachment.localId} className="group relative h-11 w-11 shrink-0">
          {/* Base image thumbnail */}
          <img
            src={attachment.objectUrl}
            alt={attachment.file.name}
            className="h-full w-full rounded-sm object-cover"
          />

          {/* Uploading: circular progress overlay */}
          {attachment.state === 'uploading' && (
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 44 44">
              <circle cx="22" cy="22" r="18" fill="rgba(17,17,27,0.7)" />
              <circle
                cx="22"
                cy="22"
                r="18"
                fill="none"
                stroke="var(--color-accent)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray={String(2 * Math.PI * 18)}
                strokeDashoffset={String(2 * Math.PI * 18 * (1 - attachment.progress / 100))}
                transform="rotate(-90 22 22)"
                className="transition-[stroke-dashoffset]"
              />
            </svg>
          )}

          {/* Error: red tint overlay + retry button */}
          {attachment.state === 'error' && (
            <div className="absolute inset-0 flex items-center justify-center rounded-sm bg-red-500/50">
              <button
                type="button"
                onClick={() => {
                  onRetry(attachment.localId);
                }}
                className="flex h-full w-1/2 cursor-pointer items-center justify-center text-white hover:bg-black/20"
                aria-label="Retry upload"
                title="Retry upload"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  onRemove(attachment.localId);
                }}
                className="flex h-full w-1/2 cursor-pointer items-center justify-center text-white hover:bg-black/20"
                aria-label="Remove failed attachment"
                title="Remove attachment"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Ready: remove button in top-right corner */}
          {attachment.state === 'ready' && (
            <button
              type="button"
              onClick={() => {
                onRemove(attachment.localId);
              }}
              className="absolute -top-1 -right-1 flex h-4 w-4 cursor-pointer items-center justify-center rounded-full border border-[rgba(180,190,254,0.08)] bg-[#181825] text-[#a6adc8] opacity-0 transition-opacity duration-200 group-hover:opacity-100 hover:text-[#cdd6f4]"
              aria-label="Remove attachment"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          )}

          {/* File size badge — bottom-right */}
          <span className="absolute right-0.5 bottom-0.5 rounded bg-[rgba(17,17,27,0.75)] px-1 text-[9px] leading-tight font-medium text-[#cdd6f4]">
            {formatSize(attachment.file.size)}
          </span>
        </div>
      ))}
    </div>
  );
}
