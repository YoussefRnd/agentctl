import { useEffect, useState } from 'react';
import { cn } from '../utils';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function useSpinnerFrame(interval = 80, done = false) {
  const [frame, setFrame] = useState(0);
  const reducedMotion = prefersReducedMotion();

  useEffect(() => {
    if (done || reducedMotion) return;
    const id = setInterval(() => {
      setFrame((prev) => (prev + 1) % FRAMES.length);
    }, interval);
    return () => {
      clearInterval(id);
    };
  }, [interval, done, reducedMotion]);

  return FRAMES[frame];
}

export interface SpinnerProps {
  done?: boolean;
  className?: string;
}

export function Spinner({ done = false, className }: SpinnerProps) {
  const frame = useSpinnerFrame(80, done);

  if (done) {
    return null;
  }

  return (
    <span
      className={cn(
        'text-accent inline-block shrink-0 font-mono text-[13px] leading-none select-none',
        className,
      )}
    >
      {frame}
    </span>
  );
}
