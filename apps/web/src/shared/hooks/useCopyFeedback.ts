import { useCallback, useEffect, useRef, useState } from 'react';

/** Keeps copy feedback local and cancels the reset timer with its display owner. */
export function useCopyFeedback(duration = 2000) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const copy = useCallback(
    (text: string) => {
      void navigator.clipboard.writeText(text);
      if (timer.current) clearTimeout(timer.current);
      setCopied(true);
      timer.current = setTimeout(() => {
        timer.current = null;
        setCopied(false);
      }, duration);
    },
    [duration],
  );
  return { copied, copy };
}
