import { parseWebEnv } from '@agentctl/shared';

const env = parseWebEnv(import.meta.env);

export const apiClient = {
  async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${env.VITE_API_URL}${path}`;
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${env.VITE_AGENTCTL_SECRET}`);
    headers.set('Content-Type', 'application/json');

    const response = await fetch(url, { ...options, headers });
    
    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }
    
    return response.json() as Promise<T>;
  }
};
