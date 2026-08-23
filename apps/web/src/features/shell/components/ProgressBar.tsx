import { useActionStore } from '../../../hooks/useActionStore';
import { useEffect, useState } from 'react';

export function ProgressBar() {
  const isAnyPending = useActionStore((state) => state.isAnyPending());
  const [{ visible, progress }, setState] = useState({ visible: false, progress: 0 });

  useEffect(() => {
    let interval: NodeJS.Timeout | undefined;
    let timeout: NodeJS.Timeout | undefined;

    if (isAnyPending) {
      const raf = requestAnimationFrame(() => {
        setState({ visible: true, progress: 0 });
      });
      interval = setInterval(() => {
        setState((prev) => {
          if (prev.progress >= 90) return prev;
          return {
            ...prev,
            progress: prev.progress + (100 - prev.progress) * 0.1,
          };
        });
      }, 200);
      return () => {
        cancelAnimationFrame(raf);
        clearInterval(interval);
      };
    }

    const raf = requestAnimationFrame(() => {
      setState((prev) => (prev.visible ? { ...prev, progress: 100 } : prev));
    });
    timeout = setTimeout(() => {
      setState({ visible: false, progress: 0 });
    }, 300);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
    };
  }, [isAnyPending]);

  if (!visible) return null;

  return (
    <div className="fixed top-0 right-0 left-0 z-[9999] h-[2px] w-full overflow-hidden bg-transparent">
      <div
        className="bg-accent h-full w-full origin-left shadow-[0_0_10px_rgba(202,158,230,0.5)] transition-transform duration-200 ease-out will-change-transform"
        style={{ transform: `scaleX(${progress / 100})` }}
      />
    </div>
  );
}
