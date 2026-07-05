import { memo } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button.js';
import { GlassPanel } from './GlassPanel.js';

export interface ConfirmationModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
  type?: 'brand-red' | 'brand-peach' | 'info';
}

export const ConfirmationModal = memo(function ConfirmationModal({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  confirmText = 'PROCEED',
  cancelText = 'CANCEL',
  type = 'info',
}: ConfirmationModalProps) {
  if (!isOpen) return null;
  if (typeof document === 'undefined') return null;

  const typeColorClass =
    type === 'brand-red'
      ? 'text-brand-red'
      : type === 'brand-peach'
        ? 'text-brand-peach'
        : 'text-brand-mauve';

  const confirmButtonClass =
    type === 'brand-red'
      ? 'bg-brand-red text-white hover:bg-brand-red/90'
      : type === 'brand-peach'
        ? 'bg-brand-peach text-white hover:bg-brand-peach/90'
        : 'bg-brand-mauve text-white hover:bg-brand-mauve/90';

  return createPortal(
    <div className="z-modal animate-in fade-in fixed inset-0 flex items-center justify-center bg-black/60 p-4 backdrop-blur-md duration-200">
      <GlassPanel className="animate-in zoom-in-95 border-brand-surface1/50 w-full max-w-sm p-5 font-mono text-[11px] shadow-2xl duration-200">
        <div className="mb-3 flex items-center gap-2">
          <span className={`text-[12px] font-black tracking-widest uppercase ${typeColorClass}`}>
            :: {title}
          </span>
        </div>

        <p className="text-text-main/80 mb-6 leading-relaxed font-bold tracking-tight uppercase">
          {message}
        </p>

        <div className="flex justify-end gap-2.5">
          <Button
            variant="ghost"
            onClick={onCancel}
            className="text-text-muted hover:text-text-main h-9 cursor-pointer px-4 font-black tracking-tight uppercase transition-all"
          >
            {cancelText}
          </Button>
          <Button
            onClick={onConfirm}
            className={`h-9 cursor-pointer px-4 font-black tracking-tight uppercase transition-all active:scale-95 ${confirmButtonClass}`}
          >
            {confirmText}
          </Button>
        </div>
      </GlassPanel>
    </div>,
    document.body,
  );
});
