import { randomUUID } from 'node:crypto';
import {
  classifyProviderError,
  providerErrorCopy,
  safeProviderErrorDetails,
  type ChatError,
  type ChatErrorAction,
  type ChatErrorCategory,
} from '@agentctl/shared';
import { AgentError } from './errors.js';
import { redactAgentErrorText } from './error-redaction.js';

export interface ChatFailureContext {
  stage: ChatError['stage'];
  providerId?: string;
  attemptId?: string;
  eventId?: number;
  id?: string;
}

/** Manual recovery only. Unknown or already accepted input must never be replayed. */
export function chatRecoveryActions(
  category: ChatErrorCategory,
  delivery: ChatError['delivery'],
  scope: ChatError['scope'],
): ChatErrorAction[] {
  const actions: ChatErrorAction[] = [];
  if (['authentication', 'billing', 'rate_limit', 'invalid_request'].includes(category))
    actions.push('provider_settings');
  if (scope === 'attempt' && (delivery === 'not_sent' || delivery === 'rejected'))
    actions.push('retry');
  if (scope === 'session' || delivery === 'unknown' || category === 'connection')
    actions.push('refresh_session');
  return actions;
}

export function normalizeChatError(error: unknown, context: ChatFailureContext): ChatError {
  const value = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  const source = error instanceof AgentError && error.cause ? error.cause : error;
  const protocol = source && typeof source === 'object' ? (source as Record<string, unknown>) : {};
  const kind = error instanceof AgentError ? error.kind : undefined;
  const category: ChatErrorCategory =
    kind === 'authentication_required'
      ? 'authentication'
      : kind === 'billing_required'
        ? 'billing'
        : kind === 'rate_limited'
          ? 'rate_limit'
          : kind === 'transport_lost'
            ? 'connection'
            : kind === 'invalid_request' || kind === 'unsupported'
              ? 'invalid_request'
              : classifyProviderError(source);
  const delivery =
    context.stage === 'prepare'
      ? 'not_sent'
      : context.stage === 'stream'
        ? 'accepted'
        : error instanceof AgentError
          ? (error.delivery ?? 'unknown')
          : 'unknown';
  const scope = context.attemptId ? 'attempt' : 'session';
  const rawMessage =
    typeof value.message === 'string' ? value.message : typeof error === 'string' ? error : '';
  const details = safeProviderErrorDetails(redactAgentErrorText(rawMessage));
  const code = protocol.code;
  const data =
    protocol.data && typeof protocol.data === 'object'
      ? (protocol.data as Record<string, unknown>)
      : {};
  const retryAfterMs = data.retryAfterMs;
  return {
    version: 1,
    id: context.id ?? (context.attemptId ? `attempt:${context.attemptId}:failure` : randomUUID()),
    category,
    scope,
    stage: context.stage,
    delivery,
    message: providerErrorCopy(category).message,
    ...(details ? { details } : {}),
    ...(typeof code === 'number' && Number.isFinite(code)
      ? { code }
      : typeof code === 'string'
        ? { code: safeProviderErrorDetails(redactAgentErrorText(code)).slice(0, 100) }
        : {}),
    ...(typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs >= 0
      ? { retryAfterMs }
      : {}),
    ...(context.providerId ? { providerId: context.providerId } : {}),
    ...(context.attemptId ? { attemptId: context.attemptId } : {}),
    ...(context.eventId !== undefined ? { eventId: context.eventId } : {}),
    actions: chatRecoveryActions(category, delivery, scope),
  };
}
