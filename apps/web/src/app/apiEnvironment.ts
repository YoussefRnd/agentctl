import { setApiBaseUrl, setUnauthorizedHandler } from '@agentctl/api-client';
export function extractPairingTokenFromUrl(): string | null {
  if (typeof window === 'undefined') return null;

  try {
    const url = new URL(window.location.href);
    const hashParams = new URLSearchParams(url.hash.slice(1));
    const token = hashParams.get('pairing');

    if (token) {
      // Strip token from URL to prevent accidental sharing
      hashParams.delete('pairing');
      url.hash = hashParams.size > 0 ? hashParams.toString() : '';
      const cleanUrl = url.pathname + (url.search ? url.search : '') + url.hash;
      window.history.replaceState({}, document.title, cleanUrl);
      return token;
    }
  } catch {
    // Ignore URL parsing errors
  }

  return null;
}

export function redirectToLogin() {
  if (typeof window === 'undefined') return;

  // In Electron Desktop, never redirect to login
  if ('electronAPI' in window) return;

  if (window.location.protocol === 'file:' || window.location.hash.length > 0) {
    if (!window.location.hash.includes('/login')) {
      window.location.hash = '#/login';
    }
  } else if (window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
}

/** One startup owner configures the backend and browser unauthorized navigation. */
export async function initApiEnvironment(): Promise<string> {
  const baseUrl = window.electronAPI
    ? `http://127.0.0.1:${await window.electronAPI.getServerPort()}`
    : '';
  setApiBaseUrl(baseUrl);
  setUnauthorizedHandler(redirectToLogin);
  return baseUrl;
}
