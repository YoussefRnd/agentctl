import { useActionStore } from '../../../hooks/useActionStore';
import { useEffect, useState } from 'react';

export function ProgressBar() {
  const isAnyPending = useActionStore((state) => state.isAnyPending());
  const [{ visible, progress }, setState] = useState({ visible: false, progress: 0 });

  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (isAnyPending) {
      setState({ visible: true, progress: 0 });
      interval = setInterval(() => {
        setState((prev) => {
          if (prev.progress >= 90) return prev;
          return {
            ...prev,
            progress: prev.progress + (100 - prev.progress) * 0.1,
          };
        });
      }, 200);
    } else {
      setState((prev) => ({ ...prev, progress: 100 }));
      const timeout = setTimeout(() => {
        setState({ visible: false, progress: 0 });
      }, 300);
      return () => {
        clearTimeout(timeout);
      };
    }

    return () => {
      clearInterval(interval);
    };
  }, [isAnyPending]);

  if (!visible) return null;

  return (
    <div className="fixed top-0 right-0 left-0 z-[9999] h-[2px] w-full overflow-hidden bg-transparent">
      <div
        className="bg-accent h-full shadow-[0_0_10px_rgba(202,158,230,0.5)] transition-colors duration-300 ease-out"
        style={{ width: `${progress.toString()}%` }}
      />
    </div>
  );
}
