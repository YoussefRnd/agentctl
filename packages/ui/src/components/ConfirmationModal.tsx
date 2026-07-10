import { memo, useRef } from 'react';
import { Button } from './Button.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './Dialog.js';

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
  const confirmedRef = useRef(false);

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

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open && !confirmedRef.current) onCancel(); confirmedRef.current = false; }}>
      <DialogContent showCloseButton={false} className="max-w-sm p-5 font-mono text-[11px]">
        <DialogHeader>
          <DialogTitle className={typeColorClass}>
            :: {title}
          </DialogTitle>
        </DialogHeader>

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
            onClick={() => { confirmedRef.current = true; onConfirm(); }}
            className={`h-9 cursor-pointer px-4 font-black tracking-tight uppercase transition-all active:scale-95 ${confirmButtonClass}`}
          >
            {confirmText}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
});
