import { ApiError } from './api-error.js';
import { getApiBaseUrl, getDesktopCapability, notifyUnauthorized } from './http/configuration.js';
export {
  setApiBaseUrl,
  getApiBaseUrl,
  setDesktopCapability,
  getDesktopCapability,
  setUnauthorizedHandler,
} from './http/configuration.js';

async function readJsonResponse(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  try {
    return await response.json();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ApiError(
      'Invalid JSON response. Check the API server connection and try again.',
      response.status,
    );
  }
}

/** JSON and typed-contract requests share authentication, cancellation and error handling. */
async function request(
  path: string,
  options: RequestInit = {},
): Promise<{ status: number; body: unknown; headers: Headers }> {
  const baseUrl = getApiBaseUrl();
  const url = baseUrl ? `${baseUrl}${path}` : path;
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
      notifyUnauthorized();
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

    return {
      status: response.status,
      body: await readJsonResponse(response),
      headers: response.headers,
    };
  } catch (error) {
    if (
      options.signal?.aborted ||
      error instanceof ApiError ||
      (error instanceof Error && error.name === 'AbortError')
    )
      throw error;
    throw new ApiError(error instanceof Error ? error.message : 'Network error', 0);
  }
}
export const apiClient = {
  async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    return (await request(path, options)).body as T;
  },
  fetchWithStatus: request,
};
