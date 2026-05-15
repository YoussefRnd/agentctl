import { parseWebEnv } from '@agentctl/shared';

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
      // Redirect to login on 401
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
      throw new Error('Unauthorized');
    }

    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }
};
