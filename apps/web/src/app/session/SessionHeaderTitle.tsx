import { useEffect, useRef } from 'react';
import { Check, X, Pencil } from 'lucide-react';

interface SessionHeaderTitleProps {
  isEditingTitle: boolean;
  editTitleValue: string;
  setEditTitleValue: (value: string) => void;
  setIsEditingTitle: (editing: boolean) => void;
  handleRenameSubmit: (e?: React.SyntheticEvent) => void;
  rawTitle: string;
  sessionDisplayTitle: string;
}

export function SessionHeaderTitle({
  isEditingTitle,
  editTitleValue,
  setEditTitleValue,
  setIsEditingTitle,
  handleRenameSubmit,
  rawTitle,
  sessionDisplayTitle,
}: SessionHeaderTitleProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditingTitle) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditingTitle]);

  if (isEditingTitle) {
    return (
      <form
        onSubmit={(e) => {
          void handleRenameSubmit(e);
        }}
        className="flex min-w-0 items-center gap-1.5"
      >
        <input
          ref={inputRef}
          type="text"
          aria-label="Edit session title"
          className="bg-surface/80 border-accent/40 text-text-main focus:border-accent max-w-36 min-w-0 flex-1 rounded-md border px-2 py-0.5 text-xs font-semibold shadow-xs outline-none"
          value={editTitleValue}
          onChange={(e) => {
            setEditTitleValue(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setIsEditingTitle(false);
            }
          }}
          onBlur={() => {
            void handleRenameSubmit();
          }}
        />
        <button
          type="submit"
          className="text-accent hover:text-accent/80 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded transition-colors active:scale-[0.97]"
          title="Save title"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => {
            setIsEditingTitle(false);
          }}
          className="text-text-muted hover:text-text-main flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded transition-colors active:scale-[0.97]"
          title="Cancel"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </form>
    );
  }

  return (
    <div className="flex min-w-0 items-center overflow-hidden">
      <div
        onDoubleClick={() => {
          setIsEditingTitle(true);
          setEditTitleValue(rawTitle);
        }}
        className="group flex min-w-0 cursor-pointer items-center"
        title="Double-click to rename"
      >
        <button
          type="button"
          onClick={() => {
            setIsEditingTitle(true);
            setEditTitleValue(rawTitle);
          }}
          className="text-text-main hover:text-accent flex max-w-[260px] min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold tracking-tight transition-[color,background-color] duration-150 hover:bg-white/[0.08] active:scale-[0.97]"
        >
          <span className="truncate">{sessionDisplayTitle}</span>
          <Pencil className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity duration-150 group-hover:opacity-60" />
        </button>
      </div>
    </div>
  );
}
