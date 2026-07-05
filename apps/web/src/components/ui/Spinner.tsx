import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
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

export function Spinner({ done = false }: { done?: boolean }) {
  const frame = useSpinnerFrame(80, done);

  if (done) {
    return <Check className="text-brand-green h-3.5 w-3.5 shrink-0 stroke-[3]" />;
  }

  return (
    <span className="text-accent inline-block shrink-0 font-mono text-[13px] leading-none select-none">
      {frame}
    </span>
  );
}
