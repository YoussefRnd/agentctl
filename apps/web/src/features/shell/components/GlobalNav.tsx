interface GlobalNavProps {
  title?: string;
}

export function GlobalNav({ title }: GlobalNavProps) {
  if (!title) return null;

  return (
    <div className="flex h-full min-w-0 flex-1 items-center gap-3">
      <span className="text-text-muted/30 font-sans text-[12px] font-medium select-none">/</span>
      <span className="text-text-muted text-[10px] font-bold tracking-[0.25em] uppercase select-none">
        {title}
      </span>
    </div>
  );
}
