import { isAgentAuthenticationRequiredError } from '../../agent/errors.js';

function errorCode(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) return '';
  return String((error as { code?: unknown }).code ?? '')
    .trim()
    .toLowerCase();
}

function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error.toLowerCase();
  if (!error || typeof error !== 'object' || !('message' in error)) return '';
  return String((error as { message?: unknown }).message ?? '').toLowerCase();
}

/** Classifies inconsistent authentication failures emitted by ACP peers. */
export function isAcpAuthenticationRequired(error: unknown): boolean {
  if (isAgentAuthenticationRequiredError(error)) return true;
  const code = errorCode(error);
  const message = errorMessage(error);
  return (
    code === 'auth_required' ||
    code === 'needs_auth' ||
    message.includes('authentication required') ||
    message.includes('auth_required') ||
    message.includes('needs_auth') ||
    message.includes('unauthenticated') ||
    message.includes('unauthorized')
  );
}

/** Classifies missing remote session failures across ACP versions and peers. */
export function isAcpSessionNotFound(error: unknown): boolean {
  if (errorCode(error) === '-32002') return true;
  const message = errorMessage(error);
  return (
    message === 'resource not found' ||
    (message.includes('session') &&
      (message.includes('not found') || message.includes('does not exist')))
  );
}

export function isAcpMethodNotFound(error: unknown): boolean {
  return errorCode(error) === '-32601';
}
