import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
  Input,
} from '@agentctl/ui';

interface RenameSessionDialogProps {
  open: boolean;
  currentTitle: string;
  onConfirm: (title: string) => void;
  onCancel: () => void;
}

export function RenameSessionDialog({
  open,
  currentTitle,
  onConfirm,
  onCancel,
}: RenameSessionDialogProps) {
  const [value, setValue] = useState(currentTitle);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(currentTitle);
      // Focus after the dialog has opened and the input is mounted.
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [open, currentTitle]);

  const handleSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed) {
      onConfirm(trimmed);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCancel();
      }}
    >
      <DialogContent showCloseButton={false} className="max-w-sm p-5">
        <DialogHeader>
          <DialogTitle>Rename session</DialogTitle>
          <DialogDescription>Enter a new title for this session.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <Input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
            }}
            className="w-full"
            aria-label="Session title"
          />

          <DialogFooter className="mt-4 flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              type="button"
              onClick={onCancel}
              className="text-text-muted hover:text-text-main h-8 px-3 text-xs font-medium transition-colors"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!value.trim()}
              className="bg-accent text-brand-crust h-8 px-4 text-xs font-medium transition-colors hover:opacity-90 active:scale-95"
            >
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
