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

export function assertApiStatus<Status extends number>(
  response: { status: number; body: unknown },
  expectedStatus: Status,
  fallbackMessage: string,
): asserts response is { status: Status; body: unknown } {
  if (response.status === expectedStatus) return;
  const body = response.body;
  const message =
    body &&
    typeof body === 'object' &&
    'message' in body &&
    typeof body.message === 'string' &&
    body.message.trim()
      ? body.message
      : `${fallbackMessage}: ${response.status}`;
  throw new ApiError(message, response.status);
}
