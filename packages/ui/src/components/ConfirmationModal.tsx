import { memo, useRef } from 'react';
import { Button } from './Button.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './Dialog.js';

export interface ConfirmationModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
  isConfirming?: boolean;
  type?: 'brand-red' | 'brand-peach' | 'info' | 'danger' | 'warning' | 'accent';
}

export const ConfirmationModal = memo(function ConfirmationModal({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  confirmText = 'Proceed',
  cancelText = 'Cancel',
  isConfirming = false,
  type = 'info',
}: ConfirmationModalProps) {
  const confirmedRef = useRef(false);

  const isDestructive = type === 'brand-red' || type === 'danger';
  const isWarning = type === 'brand-peach' || type === 'warning';

  const typeColorClass = isDestructive ? 'text-danger' : isWarning ? 'text-warning' : 'text-accent';

  const confirmButtonClass = isDestructive
    ? 'bg-danger text-white hover:bg-danger/90'
    : isWarning
      ? 'bg-warning text-white hover:bg-warning/90'
      : 'bg-accent text-brand-crust hover:opacity-90';

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !confirmedRef.current && !isConfirming) onCancel();
        confirmedRef.current = false;
      }}
    >
      <DialogContent showCloseButton={false} className="max-w-sm p-5">
        <DialogHeader>
          <DialogTitle className={typeColorClass}>{title}</DialogTitle>
        </DialogHeader>

        <p className="text-text-main/80 my-2 text-xs leading-relaxed font-normal">{message}</p>

        <DialogFooter className="mt-4 flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            onClick={onCancel}
            disabled={isConfirming}
            className="text-text-muted hover:text-text-main h-8 px-3 text-xs font-medium transition-colors"
          >
            {cancelText}
          </Button>
          <Button
            onClick={() => {
              confirmedRef.current = true;
              onConfirm();
            }}
            disabled={isConfirming}
            className={`h-8 px-4 text-xs font-medium transition-colors active:scale-[0.97] ${confirmButtonClass}`}
          >
            {isConfirming ? 'Working...' : confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
