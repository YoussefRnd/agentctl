import { parseWebEnv } from '@agentctl/shared';
import { ApiError } from './api-error';

parseWebEnv(import.meta.env);

let _baseUrl = '';

export function setApiBaseUrl(url: string) {
  _baseUrl = url;
}

export const apiClient = {
  async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const res = await this.fetchWithStatus(path, options);
    return res.body as T;
  },

  async fetchWithStatus(
    path: string,
    options: RequestInit = {},
  ): Promise<{ status: number; body: unknown; headers: Headers }> {
    const url = _baseUrl ? _baseUrl + path : path;
    const headers = new Headers(options.headers);

    const method = options.method?.toUpperCase() ?? 'GET';
    const hasBody = ['POST', 'PUT', 'PATCH'].includes(method);

    if (hasBody && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const token = typeof window !== 'undefined' ? localStorage.getItem('agentctl_token') : null;
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
        if (window.location.pathname !== '/login') {
          window.location.href = '/login';
        }
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
          // Keep the HTTP status text if the response body is not JSON.
        }

        throw new ApiError(detail, response.status);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let data: any = null;
      if (response.status !== 204) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data = await response.json();
        } catch {
          // Response body is empty or not JSON
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
