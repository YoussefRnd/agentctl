import { chatErrorSchema, type ChatErrorCategory } from './schemas/chat-error.js';

export interface ProviderErrorPresentation {
  title: string;
  message: string;
  details?: string;
}

const copy: Record<ChatErrorCategory, { title: string; message: string }> = {
  authentication: {
    title: 'Provider access required',
    message:
      'Sign in again or check your subscription with this provider, then retry or choose another provider.',
  },
  billing: {
    title: 'Provider limit reached',
    message:
      'Check your subscription, billing, or usage limits with this provider, then retry or choose another provider.',
  },
  rate_limit: {
    title: 'Provider is rate limiting requests',
    message: 'Wait before trying again, or choose another provider.',
  },
  invalid_request: {
    title: 'Message could not be processed',
    message: 'Check your message, attachments, and model settings before trying again.',
  },
  connection: {
    title: 'Agent connection interrupted',
    message: 'Refresh the session to check its current state before trying again.',
  },
  provider: {
    title: 'Agent run failed',
    message: 'The provider could not complete this turn.',
  },
  unknown: {
    title: 'Agent run failed',
    message: 'The agent could not complete this turn.',
  },
};

export function redactProviderErrorText(raw: string): string {
  return raw
    .replaceAll('\0', '')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\bAuthorization:\s*Basic\s+\S+/gi, 'Authorization: Basic [redacted]')
    .replace(
      /\b(?:x-api-key|api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*\S+/gi,
      '[redacted credential]',
    )
    .replace(
      /\b(?:sk-[A-Za-z0-9][A-Za-z0-9-]{7,}|gh[pousr]_[A-Za-z0-9]+|xox[a-zA-Z]-[A-Za-z0-9-]+)\b/g,
      '[redacted]',
    )
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/https?:\/\/[^\s]*\/pair#[^\s]*/gi, '[pairing URL]')
    .replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/gi, '$1?[redacted query]')
    .trim();
}

/** Also protects legacy persisted messages, which can contain embedded stderr or credentials. */
export function safeProviderErrorDetails(raw: string): string {
  return redactProviderErrorText(raw.split('Agent stderr:')[0]).slice(0, 2000);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/** Shared classification fallback only; classification never establishes delivery certainty. */
export function classifyProviderError(error: unknown): ChatErrorCategory {
  const value = record(error);
  const data = record(value.data);
  const nested = record(data.error);
  // Specific structured provider codes take precedence over generic JSON-RPC server errors.
  const signals = [data.code, data.type, nested.code, nested.type, value.code, value.status];
  for (const signal of signals) {
    const code = String(signal ?? '').toLowerCase();
    if (
      [
        '401',
        '-32000',
        'auth_required',
        'needs_auth',
        'unauthenticated',
        'authentication_error',
        'invalid_api_key',
      ].includes(code)
    )
      return 'authentication';
    if (
      [
        '402',
        'billing_error',
        'insufficient_quota',
        'insufficient_credits',
        'subscription_expired',
        'quota_exhausted',
      ].includes(code)
    )
      return 'billing';
    if (
      [
        '429',
        'rate_limit',
        'rate_limit_error',
        'rate_limit_exceeded',
        'too_many_requests',
      ].includes(code)
    )
      return 'rate_limit';
    if (
      [
        '-32600',
        '-32602',
        '400',
        'invalid_request',
        'invalid_request_error',
        'invalid_params',
      ].includes(code)
    )
      return 'invalid_request';
    if (['econnreset', 'econnrefused', 'etimedout', 'transport_lost'].includes(code))
      return 'connection';
    if (['500', '502', '503', '504', 'server_error', 'overloaded_error'].includes(code))
      return 'provider';
  }
  const primary = safeProviderErrorDetails(
    typeof error === 'string' ? error : typeof value.message === 'string' ? value.message : '',
  );
  if (
    /authentication required|unauthenticated|unauthorized|auth_required|needs_auth/i.test(primary)
  )
    return 'authentication';
  if (
    /subscription.*(?:expired|ended|inactive)|credit balance|insufficient (?:credits|funds)|billing|quota exhausted/i.test(
      primary,
    )
  )
    return 'billing';
  if (/rate.?limit|too many requests/i.test(primary)) return 'rate_limit';
  if (
    /connection (?:lost|closed|unavailable|reset)|transport (?:lost|closed)|request timed out/i.test(
      primary,
    )
  )
    return 'connection';
  return 'unknown';
}

export function providerErrorCopy(category: ChatErrorCategory): ProviderErrorPresentation {
  return copy[category];
}

/** New errors arrive normalized. Legacy strings are interpreted for presentation only. */
export function presentProviderError(raw?: unknown): ProviderErrorPresentation {
  const parsed = chatErrorSchema.safeParse(raw);
  if (parsed.success) {
    const error = parsed.data;
    return {
      title: copy[error.category].title,
      message: error.message,
      ...(error.details ? { details: safeProviderErrorDetails(error.details) } : {}),
    };
  }
  const category = classifyProviderError(raw);
  const value = record(raw);
  const primary = safeProviderErrorDetails(
    typeof raw === 'string' ? raw : typeof value.message === 'string' ? value.message : '',
  );
  return {
    ...copy[category],
    ...(primary ? { details: primary } : {}),
  };
}
