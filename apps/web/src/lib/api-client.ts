import { parseWebEnv } from '@agentctl/shared';
import { ApiError } from './api-error.js';

const env = parseWebEnv(import.meta.env);

export const apiClient = {
  async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${env.VITE_API_URL}${path}`;
    const headers = new Headers(options.headers);
    headers.set('Content-Type', 'application/json');

    const response = await fetch(url, {
      ...options,
      headers,
      credentials: 'include',
    });

    if (response.status === 401) {
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
      throw new ApiError('Unauthorized', 401);
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

    return response.json() as Promise<T>;
  },
};
