/**
 * Application-level error with an HTTP status code.
 * Thrown from route handlers and service utilities; caught by the global
 * Fastify error handler, which serializes it to `{ error: message }`.
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** 400 Bad Request */
export const badRequest = (msg: string) => new AppError(msg, 400);
/** 403 Forbidden */
export const forbidden = (msg: string) => new AppError(msg, 403);
/** 404 Not Found */
export const notFound = (msg: string) => new AppError(msg, 404);
/** 409 Conflict */
export const conflict = (msg: string) => new AppError(msg, 409);
