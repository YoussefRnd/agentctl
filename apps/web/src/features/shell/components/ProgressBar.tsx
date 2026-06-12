import { useActionStore } from '../../../hooks/useActionStore';
import { useEffect, useState } from 'react';

export function ProgressBar() {
  const isAnyPending = useActionStore((state) => state.isAnyPending());
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (isAnyPending) {
      setVisible(true);
      setProgress(0);
      interval = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 90) return prev;
          return prev + (100 - prev) * 0.1;
        });
      }, 200);
    } else {
      setProgress(100);
      const timeout = setTimeout(() => {
        setVisible(false);
        setProgress(0);
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
    <div className="fixed top-0 left-0 right-0 z-[9999] h-[2px] w-full bg-transparent overflow-hidden">
      <div
        className="h-full bg-accent transition-all duration-300 ease-out shadow-[0_0_10px_rgba(202,158,230,0.5)]"
        style={{ width: `${progress.toString()}%` }}
      />
    </div>
  );
}
