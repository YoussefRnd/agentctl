import { RefreshCw, X } from 'lucide-react';

import type { PendingAttachment } from '../../../hooks/useAttachments';

interface AttachmentStripProps {
  attachments: PendingAttachment[];
  onRemove: (localId: string) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes.toString()} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentStrip({ attachments, onRemove }: AttachmentStripProps) {
  if (attachments.length === 0) return null;

  return (
    <div
      className="flex items-center gap-2 px-4 py-2 overflow-x-auto"
      style={{ scrollbarWidth: 'none' }}
    >
      {attachments.map((attachment) => (
        <div key={attachment.localId} className="group relative shrink-0 w-11 h-11">
          {/* Base image thumbnail */}
          <img
            src={attachment.objectUrl}
            alt={attachment.file.name}
            className="w-full h-full object-cover rounded-sm"
          />

          {/* Uploading: circular progress overlay */}
          {attachment.state === 'uploading' && (
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 44 44">
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
                className="motion-safe:transition-[stroke-dashoffset] duration-200"
              />
            </svg>
          )}

          {/* Error: red tint overlay + retry icon */}
          {attachment.state === 'error' && (
            <button
              type="button"
              onClick={() => {
                onRemove(attachment.localId);
              }}
              className="absolute inset-0 flex items-center justify-center rounded-sm bg-red-500/40 cursor-pointer"
              aria-label="Retry upload"
            >
              <RefreshCw className="w-4 h-4 text-white" />
            </button>
          )}

          {/* Ready: remove button in top-right corner */}
          {attachment.state === 'ready' && (
            <button
              type="button"
              onClick={() => {
                onRemove(attachment.localId);
              }}
              className="absolute -top-1 -right-1 flex items-center justify-center w-4 h-4 rounded-full bg-[#181825] border border-[rgba(180,190,254,0.08)] text-[#a6adc8] hover:text-[#cdd6f4] opacity-0 group-hover:opacity-100 transition-opacity duration-200 cursor-pointer"
              aria-label="Remove attachment"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          )}

          {/* File size badge — bottom-right */}
          <span className="absolute bottom-0.5 right-0.5 rounded px-1 text-[9px] leading-tight font-medium text-[#cdd6f4] bg-[rgba(17,17,27,0.75)]">
            {formatSize(attachment.file.size)}
          </span>
        </div>
      ))}
    </div>
  );
}
