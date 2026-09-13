import type { AgentConfigOption } from '@agentctl/shared';
import type { AgentSession } from './types.js';

export type AgentErrorKind =
  | 'authentication_required'
  | 'unsupported'
  | 'invalid_request'
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
