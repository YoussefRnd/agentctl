import type { AgentConfigOption } from '@agentctl/shared';
import type { AgentSession } from './types.js';

export type AgentErrorKind =
  | 'authentication_required'
  | 'unsupported'
  | 'invalid_request'
  | 'prompt_rejected'
  | 'transport_lost'
  | 'agent_failure';

export class AgentError extends Error {
  constructor(
    public readonly kind: AgentErrorKind,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AgentError';
  }
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
    super('authentication_required', 'Authentication required');
    this.name = 'AgentAuthenticationRequiredError';
  }
}

export function isAgentAuthenticationRequiredError(error: unknown): boolean {
  return (
    error instanceof AgentAuthenticationRequiredError ||
    (error instanceof AgentError && error.kind === 'authentication_required')
  );
}
