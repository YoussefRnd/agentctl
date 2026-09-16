import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

export interface UseDoubleEscToStopOptions {
  isRunning: boolean;
  onStop: () => void;
  thresholdMs?: number;
}

export const ESC_STOP_TOAST_ID = 'esc-stop-agent';

export function useDoubleEscToStop({
  isRunning,
  onStop,
  thresholdMs = 1000,
}: UseDoubleEscToStopOptions) {
  const lastEscTimeRef = useRef<number>(0);
  const onStopRef = useRef(onStop);
  const isRunningRef = useRef(isRunning);

  useEffect(() => {
    onStopRef.current = onStop;
    isRunningRef.current = isRunning;
  }, [onStop, isRunning]);

  // If status transitions from running to idle, reset timer
  useEffect(() => {
    if (!isRunning) {
      lastEscTimeRef.current = 0;
    }
  }, [isRunning]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') {
        // Reset if user pressed another key
        lastEscTimeRef.current = 0;
        return;
      }

      if (!isRunningRef.current) {
        lastEscTimeRef.current = 0;
        return;
      }

      // If a modal/dialog is currently mounted/open, let it handle Escape
      const isModalOpen = Boolean(document.querySelector('[role="dialog"], [role="alertdialog"]'));
      if (isModalOpen) {
        lastEscTimeRef.current = 0;
        return;
      }

      const now = Date.now();
      const timeSinceLastEsc = now - lastEscTimeRef.current;

      if (lastEscTimeRef.current > 0 && timeSinceLastEsc <= thresholdMs) {
        // Double Escape detected!
        e.preventDefault();
        e.stopPropagation();
        lastEscTimeRef.current = 0;
        toast.info('Agent stopped', { id: ESC_STOP_TOAST_ID });
        onStopRef.current();
      } else {
        // First Escape press
        lastEscTimeRef.current = now;
        toast.info('Press Esc again to stop the agent', {
          id: ESC_STOP_TOAST_ID,
          duration: thresholdMs + 500,
        });
      }
    };

    const handleBlur = () => {
      lastEscTimeRef.current = 0;
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      window.removeEventListener('blur', handleBlur);
    };
  }, [thresholdMs]);
}
