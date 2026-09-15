import { Check, AlertTriangle, AlertOctagon } from 'lucide-react';

interface ChecklistItemProps {
  label: string;
  checked: boolean;
  error?: string;
  warning?: string;
}

export function ChecklistItem({ label, checked, error, warning }: ChecklistItemProps) {
  return (
    <li className="flex items-start justify-between text-xs select-none">
      <span
        className={
          error ? 'text-danger font-medium' : checked ? 'text-text-main' : 'text-text-muted/60'
        }
      >
        {label}
        {error && (
          <span className="text-danger/80 mt-0.5 block text-[10px] font-normal italic">
            {error}
          </span>
        )}
      </span>
      <span className="shrink-0 font-mono text-xs font-semibold">
        {error ? (
          <span className="text-danger flex items-center gap-1">
            <AlertOctagon className="text-danger h-3.5 w-3.5" /> [Fail]
          </span>
        ) : checked ? (
          <span className="text-success flex items-center gap-1">
            <Check className="text-success h-3.5 w-3.5" /> [Pass]
          </span>
        ) : warning ? (
          <span className="text-warning flex items-center gap-1">
            <AlertTriangle className="text-warning h-3.5 w-3.5" /> [{warning}]
          </span>
        ) : (
          <span className="text-text-muted/40">[Pending]</span>
        )}
      </span>
    </li>
  );
}
