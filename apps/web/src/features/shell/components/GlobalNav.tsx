interface GlobalNavProps {
  title?: string;
}

export function GlobalNav({ title }: GlobalNavProps) {
  if (!title) return null;

  return (
    <div className="flex h-full min-w-0 flex-1 items-center">
      <div className="border-border/20 bg-surface/40 flex items-center gap-1.5 rounded-full border px-2.5 py-1">
        <span className="bg-accent/60 h-1.5 w-1.5 animate-pulse rounded-full" />
        <span className="text-text-muted text-[10px] font-bold tracking-[0.15em] uppercase">
          {title}
        </span>
      </div>
    </div>
  );
}
