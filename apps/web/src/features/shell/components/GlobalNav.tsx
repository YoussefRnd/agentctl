import { Link } from 'react-router-dom';

interface GlobalNavProps {
  title?: string;
}

export function GlobalNav({ title }: GlobalNavProps) {
  return (
    <div className="border-border/50 bg-background/50 relative z-40 border-b backdrop-blur-xl">
      <div className="flex h-14 items-center gap-3 px-3">
        <div className="hidden w-[240px] shrink-0 items-center lg:flex">
          <Link
            to="/"
            className="text-text-main font-sans text-[12px] font-black tracking-[0.4em] uppercase transition-opacity hover:opacity-80"
          >
            AGENTCTL
          </Link>
        </div>
        <div className="flex shrink-0 items-center pl-2 lg:hidden">
          <Link
            to="/"
            className="text-text-main font-sans text-[12px] font-black tracking-[0.4em] uppercase transition-opacity hover:opacity-80"
          >
            AGENTCTL
          </Link>
        </div>
        {title && (
          <div className="flex h-full min-w-0 flex-1 items-center">
            <div className="border-border/20 bg-surface/40 flex items-center gap-1.5 rounded-full border px-2.5 py-1">
              <span className="bg-accent/60 h-1.5 w-1.5 animate-pulse rounded-full" />
              <span className="text-text-muted text-[10px] font-bold tracking-[0.15em] uppercase">
                {title}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
