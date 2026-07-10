import { Minus, Square, X, Copy } from 'lucide-react';

interface TitleBarWindowControlsProps {
  isMaximized: boolean;
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
}

export function TitleBarWindowControls({
  isMaximized,
  onMinimize,
  onMaximize,
  onClose,
}: TitleBarWindowControlsProps) {
  const controlBase =
    'flex h-full w-11 items-center justify-center text-text-muted transition-colors duration-150 app-region-no-drag';

  return (
    <div className="flex h-full items-stretch">
      <button
        type="button"
        aria-label="Minimize"
        onClick={onMinimize}
        className={`${controlBase} hover:bg-white/5`}
      >
        <Minus className="h-3.5 w-3.5" strokeWidth={2.5} />
      </button>
      <button
        type="button"
        aria-label={isMaximized ? 'Restore' : 'Maximize'}
        onClick={onMaximize}
        className={`${controlBase} hover:bg-white/5`}
      >
        {isMaximized ? (
          <Copy className="h-3 w-3" strokeWidth={2.5} />
        ) : (
          <Square className="h-3 w-3" strokeWidth={2.5} />
        )}
      </button>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className={`${controlBase} w-11 hover:bg-[#e81123] hover:text-white`}
      >
        <X className="h-3.5 w-3.5" strokeWidth={2.5} />
      </button>
    </div>
  );
}
