import { ApiError } from './api-error.js';

let apiBaseUrl = '';

export function setApiBaseUrl(url: string) {
  apiBaseUrl = url;
}

export function getApiBaseUrl(): string {
  return apiBaseUrl;
}

const CREDENTIAL_KEY = 'agentctl_session_key';
let inMemoryCredential: string | null = null;

function readStoredCredential(): string | null {
  if (inMemoryCredential) return inMemoryCredential;
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CREDENTIAL_KEY);
    inMemoryCredential = raw;
    return raw;
  } catch {
    return null;
  }
}

function writeStoredCredential(val: string | null): void {
  inMemoryCredential = val;
  if (typeof window === 'undefined') return;
  try {
    if (val === null) {
      window.localStorage.removeItem(CREDENTIAL_KEY);
    } else {
      window.localStorage.setItem(CREDENTIAL_KEY, val);
    }
  } catch {
    // Ignore storage quota/permission errors
  }
}

export function getAuthToken(): string | null {
  return readStoredCredential();
}

export function setAuthToken(value: string): void {
  writeStoredCredential(value);
}

export function clearAuthToken(): void {
  writeStoredCredential(null);
}

export function extractAndPersistUrlToken(): string | null {
  if (typeof window === 'undefined') return null;

  try {
    const url = new URL(window.location.href);
    let token = url.searchParams.get('token');

    // Also check hash query params if hash routing is used (e.g. #/?token=...)
    if (!token && window.location.hash.includes('token=')) {
      const hashParts = window.location.hash.split('?');
      if (hashParts[1]) {
        const hashParams = new URLSearchParams(hashParts[1]);
        token = hashParams.get('token');
      }
    }

    if (token) {
      setAuthToken(token);

      // Strip token from URL to prevent accidental sharing
      url.searchParams.delete('token');
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

export const apiClient = {
  async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = apiBaseUrl ? `${apiBaseUrl}${path}` : path;
    const method = (options.method ?? 'GET').toUpperCase();
    const hasBody = method !== 'GET' && method !== 'HEAD';

    const headers = new Headers(options.headers);
    if (hasBody && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const token = getAuthToken();
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    try {
      const response = await fetch(url, {
        ...options,
        method,
        headers,
        body: hasBody && options.body === undefined ? JSON.stringify({}) : options.body,
        credentials: 'include',
      });

      if (response.status === 401) {
        redirectToLogin();
        throw new ApiError('Unauthorized', 401);
      }

      if (response.status >= 500) {
        throw new ApiError('Internal Server Error', response.status);
      }

      if (!response.ok) {
        let detail = response.statusText;
        try {
          const body = (await response.clone().json()) as { error?: unknown; message?: unknown };
          const bodyMessage =
            typeof body.error === 'string'
              ? body.error
              : typeof body.message === 'string'
                ? body.message
                : null;
          if (bodyMessage) detail = bodyMessage;
        } catch {
          // Keep HTTP status text if response is not JSON
        }

        throw new ApiError(detail, response.status);
      }

      let data: unknown = null;
      if (response.status !== 204) {
        try {
          data = (await response.json()) as unknown;
        } catch {
          // Empty or non-JSON body
        }
      }
      return data as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof Error && error.name === 'AbortError') throw error;

      throw new ApiError(error instanceof Error ? error.message : 'Network error', 0);
    }
  },

  async fetchWithStatus(
    path: string,
    options: RequestInit = {},
  ): Promise<{ status: number; body: unknown; headers: Headers }> {
    const url = apiBaseUrl ? `${apiBaseUrl}${path}` : path;
    const method = (options.method ?? 'GET').toUpperCase();
    const hasBody = method !== 'GET' && method !== 'HEAD';

    const headers = new Headers(options.headers);
    if (hasBody && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const token = getAuthToken();
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    try {
      const response = await fetch(url, {
        ...options,
        method,
        headers,
        body: hasBody && options.body === undefined ? JSON.stringify({}) : options.body,
        credentials: 'include',
      });

      if (response.status === 401) {
        redirectToLogin();
        throw new ApiError('Unauthorized', 401);
      }

      if (response.status >= 500) {
        throw new ApiError('Internal Server Error', response.status);
      }

      if (!response.ok) {
        let detail = response.statusText;
        try {
          const body = (await response.clone().json()) as { error?: unknown; message?: unknown };
          const bodyMessage =
            typeof body.error === 'string'
              ? body.error
              : typeof body.message === 'string'
                ? body.message
                : null;
          if (bodyMessage) detail = bodyMessage;
        } catch {
          // Keep HTTP status text if response is not JSON
        }

        throw new ApiError(detail, response.status);
      }

      let data: unknown = null;
      if (response.status !== 204) {
        try {
          data = (await response.json()) as unknown;
        } catch {
          // Empty or non-JSON body
        }
      }
      return {
        status: response.status,
        body: data,
        headers: response.headers,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof Error && error.name === 'AbortError') throw error;

      throw new ApiError(error instanceof Error ? error.message : 'Network error', 0);
    }
  },
};
