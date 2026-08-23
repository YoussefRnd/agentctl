import { Check, X, Pencil } from 'lucide-react';

interface SessionHeaderTitleProps {
  isEditingTitle: boolean;
  editTitleValue: string;
  setEditTitleValue: (value: string) => void;
  setIsEditingTitle: (editing: boolean) => void;
  handleRenameSubmit: (e?: React.SyntheticEvent) => void;
  rawTitle: string;
  sessionDisplayTitle: string;
  projectName: string;
}

export function SessionHeaderTitle({
  isEditingTitle,
  editTitleValue,
  setEditTitleValue,
  setIsEditingTitle,
  handleRenameSubmit,
  rawTitle,
  sessionDisplayTitle,
  projectName,
}: SessionHeaderTitleProps) {
  if (isEditingTitle) {
    return (
      <form
        onSubmit={(e) => {
          void handleRenameSubmit(e);
        }}
        className="flex min-w-0 flex-1 items-center gap-1.5"
      >
        <input
          ref={(el) => {
            if (el) {
              el.focus();
              el.select();
            }
          }}
          type="text"
          aria-label="Edit session title"
          className="bg-surface border-border text-text-main focus:border-accent w-full rounded border px-1.5 py-0.5 text-xs font-medium outline-none"
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
          className="text-accent hover:text-accent/80 shrink-0 p-0.5 transition-colors"
          title="Save title"
        >
          <Check className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => {
            setIsEditingTitle(false);
          }}
          className="text-text-muted hover:text-text-main shrink-0 p-0.5 transition-colors"
          title="Cancel"
        >
          <X className="h-3 w-3" />
        </button>
      </form>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
      <div
        onDoubleClick={() => {
          setIsEditingTitle(true);
          setEditTitleValue(rawTitle);
        }}
        className="group flex min-w-0 cursor-pointer items-center gap-1.5"
        title="Double click to rename"
      >
        <button
          type="button"
          onClick={() => {
            setIsEditingTitle(true);
            setEditTitleValue(rawTitle);
          }}
          className="text-text-main hover:text-accent flex min-w-0 cursor-pointer items-center gap-1 text-xs font-semibold tracking-tight transition-colors"
        >
          <span className="truncate">{sessionDisplayTitle}</span>
          <Pencil className="h-2.5 w-2.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
        </button>
      </div>

      {projectName && (
        <span className="text-text-muted/50 hidden shrink-0 text-xs font-normal sm:inline">
          · {projectName}
        </span>
      )}
    </div>
  );
}
