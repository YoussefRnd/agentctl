import { useState, useEffect } from 'react';

const STORAGE_KEY = 'agentctl-setup-wizard-done';

export function useSetupWizard() {
  const [isDone, setIsDone] = useState<boolean>(true); // default to true until we check
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    const stored = localStorage.getItem(STORAGE_KEY);
    setIsDone(stored === 'true');
  }, []);

  const markDone = () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setIsDone(true);
  };

  return {
    showWizard: isMounted && !isDone,
    markDone,
  };
}
