import { useEffect, useState, type ReactNode } from 'react';
import { ImageIcon, ImageOff, Loader2, Maximize2, RefreshCw } from 'lucide-react';
import { Button } from '../primitives/Button/index.js';
import { Dialog, DialogContent, DialogTitle } from '../primitives/Dialog/index.js';
import { cn } from '../utils.js';

export interface ImagePreviewProps {
  src?: string;
  filename: string;
  status?: 'loading' | 'ready' | 'error';
  previewable?: boolean;
  showFilename?: boolean;
  className?: string;
  imageClassName?: string;
  onRetry?: () => void;
  onImageError?: () => void;
  children?: ReactNode;
}

/** Shared thumbnail and full-size viewer; callers own image URLs and upload state. */
export function ImagePreview({
  src,
  filename,
  status = 'ready',
  previewable = true,
  showFilename = false,
  className,
  imageClassName,
  onRetry,
  onImageError,
  children,
}: ImagePreviewProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setIsOpen(false);
    setFailed(false);
  }, [src]);
  const imageStatus = failed ? 'error' : status;
  const handleError = () => {
    setFailed(true);
    setIsOpen(false);
    onImageError?.();
  };
  const image =
    src && imageStatus === 'ready' ? (
      <img
        src={src}
        alt={filename}
        loading="lazy"
        className={cn('block h-full w-full object-contain', imageClassName)}
        onError={handleError}
      />
    ) : null;

  return (
    <div
      className={cn(
        'group/image border-border/40 bg-surface-secondary/40 relative max-w-full overflow-hidden rounded-xl border',
        className,
      )}
    >
      {image ? (
        previewable ? (
          <button
            type="button"
            aria-label={`Preview ${filename}`}
            onClick={() => setIsOpen(true)}
            className={cn(
              'focus-visible:ring-accent relative block w-full cursor-zoom-in focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
              !showFilename && 'h-full',
            )}
          >
            {image}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-1.5 left-1.5 rounded-md bg-black/60 p-1 text-white opacity-0 transition-opacity group-focus-within/image:opacity-100 group-hover/image:opacity-100 [@media(hover:none)]:opacity-100"
            >
              <Maximize2 className="h-3 w-3" />
            </span>
          </button>
        ) : (
          image
        )
      ) : (
        <div
          className={cn(
            'text-text-muted flex h-full min-h-16 flex-col items-center justify-center gap-2 px-3 text-xs',
            imageClassName,
          )}
        >
          {imageStatus === 'error' ? (
            <>
              <ImageOff aria-hidden="true" className="h-5 w-5" />
              <span role="status">Image unavailable</span>
              {onRetry && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Retry loading ${filename}`}
                  onClick={onRetry}
                  className="h-7 gap-1.5 text-xs"
                >
                  <RefreshCw aria-hidden="true" className="h-3 w-3" /> Retry
                </Button>
              )}
            </>
          ) : (
            <>
              <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />
              <span role="status">Loading image…</span>
            </>
          )}
        </div>
      )}
      {showFilename && (
        <div
          className="border-border/30 text-text-muted flex min-w-0 items-center gap-1.5 border-t px-2.5 py-2 text-[11px]"
          title={filename}
        >
          <ImageIcon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{filename}</span>
        </div>
      )}
      {children}
      {src && imageStatus === 'ready' && previewable && (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogContent
            aria-describedby={undefined}
            className="border-border/50 bg-brand-mantle flex max-w-4xl flex-col gap-3 border p-4"
          >
            <DialogTitle className="text-text-main mr-7 truncate text-xs font-semibold">
              {filename}
            </DialogTitle>
            <img
              src={src}
              alt={filename}
              onError={handleError}
              className="max-h-[calc(100dvh-7rem)] min-h-0 max-w-full object-contain"
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
