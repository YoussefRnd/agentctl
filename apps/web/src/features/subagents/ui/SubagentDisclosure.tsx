import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

export function SubagentDisclosure({
  title,
  label = title,
  hint,
  initiallyOpen = false,
  children,
}: {
  title: string;
  label?: string;
  hint?: string;
  initiallyOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="border-border/40 group/disclosure rounded-lg border"
    >
      <summary className="text-text-main focus-visible:ring-accent/50 flex cursor-pointer items-center gap-2 rounded-lg px-4 py-3 text-xs font-medium focus-visible:ring-2 focus-visible:outline-none">
        <ChevronRight
          aria-hidden
          className="h-3.5 w-3.5 shrink-0 transition-transform group-open/disclosure:rotate-90"
        />
        {title}
        {hint && <span className="text-text-muted ml-auto text-right font-normal">{hint}</span>}
      </summary>
      <section aria-label={label} className="border-border/30 border-t p-4">
        {children}
      </section>
    </details>
  );
}
