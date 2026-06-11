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
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
      <GlassPanel className="w-full max-w-sm rounded-xl p-5 shadow-2xl font-mono text-[11px] animate-in zoom-in-95 duration-200 border-brand-surface1/50">
        <div className="flex items-center gap-2 mb-3">
          <span className={`text-[12px] font-black tracking-widest uppercase ${typeColorClass}`}>
            :: {title}
          </span>
        </div>

        <p className="text-text-main/80 leading-relaxed mb-6 font-bold uppercase tracking-tight">
          {message}
        </p>

        <div className="flex justify-end gap-2.5">
          <Button
            variant="ghost"
            onClick={onCancel}
            className="h-9 px-4 rounded-xl text-text-muted hover:text-text-main font-black uppercase transition-all tracking-tight cursor-pointer"
          >
            {cancelText}
          </Button>
          <Button
            onClick={onConfirm}
            className={`h-9 px-4 rounded-xl font-black uppercase transition-all tracking-tight cursor-pointer active:scale-95 ${confirmButtonClass}`}
          >
            {confirmText}
          </Button>
        </div>
      </GlassPanel>
    </div>,
    document.body
  );
});
