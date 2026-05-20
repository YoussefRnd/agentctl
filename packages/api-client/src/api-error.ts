/**
 * Thrown by the API client when the server returns a non-2xx response.
 * Callers can check `err instanceof ApiError` and inspect `err.status`
 * to distinguish e.g. 404 from 400 from network failures.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
