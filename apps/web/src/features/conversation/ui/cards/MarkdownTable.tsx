import type { ComponentPropsWithoutRef } from 'react';

/** Keep wide tables scrollable without widening the surrounding conversation. */
export function MarkdownTable({ children, ...props }: ComponentPropsWithoutRef<'table'>) {
  return (
    <div
      className="markdown-table focus-visible:ring-accent/40 my-4 max-w-full overflow-x-auto rounded-md focus-visible:ring-2 focus-visible:outline-none"
      role="region"
      aria-label="Scrollable table"
      tabIndex={0}
    >
      <table {...props}>{children}</table>
    </div>
  );
}
