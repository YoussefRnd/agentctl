import { ApiError } from './api-error.js';

let apiBaseUrl = '';

export function setApiBaseUrl(url: string) {
  apiBaseUrl = url;
}

export function redirectToLogin() {
  if (typeof window === 'undefined') return;
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
