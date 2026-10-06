import { ApiError } from './api-error.js';

async function readJsonResponse(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  try {
    return await response.json();
  } catch {
    throw new ApiError(
      'Invalid JSON response. Check the API server connection and try again.',
      response.status,
    );
  }
}

let apiBaseUrl = '';

export function setApiBaseUrl(url: string) {
  apiBaseUrl = url;
}

export function getApiBaseUrl(): string {
  return apiBaseUrl;
}

let desktopCapability: string | null = null;

export function getDesktopCapability(): string | null {
  return desktopCapability;
}

export function setDesktopCapability(value: string): void {
  desktopCapability = value;
}

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

export const apiClient = {
  async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = apiBaseUrl ? `${apiBaseUrl}${path}` : path;
    const method = (options.method ?? 'GET').toUpperCase();
    const hasBody = method !== 'GET' && method !== 'HEAD';

    const headers = new Headers(options.headers);
    if (hasBody && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const token = getDesktopCapability();
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

      const data = await readJsonResponse(response);
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
    const token = getDesktopCapability();
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

      const data = await readJsonResponse(response);
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
