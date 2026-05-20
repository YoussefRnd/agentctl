import { parseWebEnv } from '@agentctl/shared';
import { ApiError } from './api-error';

const env = parseWebEnv(import.meta.env);

export const apiClient = {
  async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = path;
    const headers = new Headers(options.headers);

    const method = options.method?.toUpperCase() ?? 'GET';
    const hasBody = ['POST', 'PUT', 'PATCH'].includes(method);

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

      const data = (await response.json()) as T;
      return data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof Error && error.name === 'AbortError') throw error;

      throw new ApiError(error instanceof Error ? error.message : 'Network error', 0);
    }
  },
};
