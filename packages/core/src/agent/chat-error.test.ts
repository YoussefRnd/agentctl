import { describe, expect, it } from 'vite-plus/test';
import { chatErrorSchema } from '@agentctl/shared';
import { AgentError, AgentPromptRejectedError, normalizeAgentError } from './errors.js';
import { chatRecoveryActions, normalizeChatError } from './chat-error.js';

const context = {
  stage: 'dispatch' as const,
  attemptId: 'attempt',
  eventId: 4,
  providerId: 'any-provider',
};

describe('shared chat failure policy', () => {
  it.each([
    'authentication',
    'billing',
    'rate_limit',
    'invalid_request',
    'connection',
    'provider',
    'unknown',
  ] as const)('does not offer replay for %s with uncertain or accepted delivery', (category) => {
    for (const delivery of ['unknown', 'accepted'] as const) {
      expect(chatRecoveryActions(category, delivery, 'attempt')).not.toContain('retry');
    }
  });

  it.each([
    [{ code: 401, message: 'Access refused' }, 'authentication'],
    [{ code: 402, message: 'Payment refused' }, 'billing'],
    [{ code: 429, message: 'Slow down', data: { retryAfterMs: 2000 } }, 'rate_limit'],
    [{ code: -32602, message: 'Invalid input' }, 'invalid_request'],
  ] as const)('keeps category and explicit rejection separate for %j', (protocol, category) => {
    const rejected = normalizeChatError(new AgentPromptRejectedError(protocol), context);
    expect(rejected).toMatchObject({
      category,
      delivery: 'rejected',
      actions: expect.arrayContaining(['retry']),
    });
    const unknown = normalizeChatError(normalizeAgentError(protocol), context);
    expect(unknown).toMatchObject({ category, delivery: 'unknown' });
    expect(unknown.actions).not.toContain('retry');
    expect(chatErrorSchema.parse(rejected)).toEqual(rejected);
  });

  it('never turns text-matched access errors into proof of rejection', () => {
    const error = normalizeAgentError(new Error('Authentication required'));
    expect(normalizeChatError(error, context)).toMatchObject({
      category: 'authentication',
      delivery: 'unknown',
    });
  });

  it('lets acceptance/output evidence override an authentication rejection', () => {
    const error = new AgentError('authentication_required', 'Authentication required', {
      delivery: 'rejected',
    });
    const failure = normalizeChatError(error, { ...context, stage: 'stream' });
    expect(failure.delivery).toBe('accepted');
    expect(failure.actions).not.toContain('retry');
  });

  it('permits a new manual attempt when preparation failed, without automatic replay', () => {
    const failure = normalizeChatError(new Error('Unexpected preparation failure'), {
      ...context,
      stage: 'prepare',
    });
    expect(failure).toMatchObject({ delivery: 'not_sent', actions: ['retry'] });
  });

  it('has a stable identity, safe bounded diagnostics, and no raw payload data', () => {
    const failure = normalizeChatError(
      {
        code: 429,
        message: 'Bearer private-token\n' + 'x'.repeat(4000) + '\nAgent stderr: internal timing',
        data: { retryAfterMs: 2000, apiKey: 'do-not-expose' },
      },
      context,
    );
    expect(failure).toMatchObject({
      id: 'attempt:attempt:failure',
      retryAfterMs: 2000,
      providerId: 'any-provider',
    });
    expect(failure.details!.length).toBeLessThanOrEqual(2000);
    expect(JSON.stringify(failure)).not.toMatch(/private-token|do-not-expose|internal timing/);
    expect(failure).not.toHaveProperty('data');
  });

  it('provides session recovery without a message replay action', () => {
    const failure = normalizeChatError(new AgentError('transport_lost', 'Connection lost'), {
      stage: 'dispatch',
      id: 'runtime-error',
    });
    expect(failure).toMatchObject({ scope: 'session', actions: ['refresh_session'] });
  });
});
