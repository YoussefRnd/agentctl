import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export function useNativeNavigation(): void {
  const navigate = useNavigate();
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    const localNavigate = (path: string) => {
      if (path.startsWith('/') && !path.startsWith('//')) void navigate(path);
    };
    const unsubscribeNavigate = api.onNavigate(localNavigate);
    const unsubscribeDeepLink = api.onDeepLink((value) => {
      try {
        const url = new URL(value);
        if (url.protocol === 'agentctl:' && /^\/sessions(?:\/|$)/.test(url.pathname))
          localNavigate(url.pathname);
      } catch {
        /* Ignore malformed native links. */
      }
    });
    return () => {
      unsubscribeDeepLink();
      unsubscribeNavigate();
    };
  }, [navigate]);
}
