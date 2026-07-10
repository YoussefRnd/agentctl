interface StreamingDotsProps {
  className?: string;
}

export function StreamingDots({ className = 'ml-1' }: StreamingDotsProps) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span className="bg-accent/70 h-1 w-1 animate-pulse rounded-full [animation-delay:-0.3s]" />
      <span className="bg-accent/70 h-1 w-1 animate-pulse rounded-full [animation-delay:-0.15s]" />
      <span className="bg-accent/70 h-1 w-1 animate-pulse rounded-full" />
    </span>
  );
}
