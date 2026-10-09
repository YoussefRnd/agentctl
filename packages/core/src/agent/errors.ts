import {
  classifyProviderError,
  type AgentConfigOption,
  type ChatErrorDelivery,
} from '@agentctl/shared';
import type { AgentSession } from './types.js';

export type AgentErrorKind =
  | 'authentication_required'
  | 'billing_required'
  | 'rate_limited'
  | 'unsupported'
  | 'invalid_request'
  | 'prompt_rejected'
  | 'transport_lost'
  | 'agent_failure';

export class AgentError extends Error {
  readonly delivery?: ChatErrorDelivery;
  constructor(
    public readonly kind: AgentErrorKind,
    message: string,
    options?: { cause?: unknown; delivery?: ChatErrorDelivery },
  ) {
    super(message, options);
    this.name = 'AgentError';
    this.delivery = options?.delivery ?? (kind === 'prompt_rejected' ? 'rejected' : undefined);
  }
}

/** Preserve protocol evidence separately from a provider's failure category. */
export function normalizeAgentError(error: unknown, delivery?: ChatErrorDelivery): AgentError {
  if (error instanceof AgentError && delivery === undefined) return error;
  const category = classifyProviderError(error);
  const kind: AgentErrorKind =
    error instanceof AgentError
      ? error.kind
      : category === 'authentication'
        ? 'authentication_required'
        : category === 'billing'
          ? 'billing_required'
          : category === 'rate_limit'
            ? 'rate_limited'
            : category === 'invalid_request'
              ? 'invalid_request'
              : category === 'connection'
                ? 'transport_lost'
                : 'agent_failure';
  const message =
    error instanceof Error
      ? error.message
      : error &&
          typeof error === 'object' &&
          'message' in error &&
          typeof error.message === 'string'
        ? error.message
        : String(error);
  // Text classification can guide recovery, but cannot prove that insertion was rejected.
  return new AgentError(kind, message, { cause: error, delivery: delivery ?? 'unknown' });
}

/** A provider explicitly rejected insertion; delivery is known to have failed. */
export class AgentPromptRejectedError extends AgentError {
  readonly code: number;
  readonly data?: unknown;

  constructor(error: { code: number; message: string; data?: unknown }) {
    super('prompt_rejected', error.message, { cause: error });
    this.name = 'AgentPromptRejectedError';
    this.code = error.code;
    this.data = error.data;
  }
}

export class AgentAuthenticationRequiredError extends AgentError {
  constructor(
    public readonly pendingSession: AgentSession,
    public readonly configOptions: AgentConfigOption[] = [],
  ) {
    super('authentication_required', 'Authentication required', { delivery: 'rejected' });
    this.name = 'AgentAuthenticationRequiredError';
  }
}

export function isAgentAuthenticationRequiredError(error: unknown): boolean {
  return (
    error instanceof AgentAuthenticationRequiredError ||
    (error instanceof AgentError && error.kind === 'authentication_required')
  );
}
