import { expect, it } from 'vitest';
import {
  classifyProviderError,
  presentProviderError,
  safeProviderErrorDetails,
} from './provider-error.js';

it('summarizes access failures without treating stderr as part of the cause', () => {
  const error = presentProviderError(
    'Authentication required\nAgent stderr: [session/create] timing=1620',
  );
  expect(error.title).toBe('Provider access required');
  expect(error.message).toContain('subscription');
  expect(error.details).toBe('Authentication required');
  expect(JSON.stringify(error)).not.toContain('session/create');
  expect(presentProviderError('Connection lost\nAgent stderr: auth_required').title).toBe(
    'Agent connection interrupted',
  );
});

it('provides billing guidance without claiming authentication failed', () => {
  expect(presentProviderError('Your credit balance is too low')).toMatchObject({
    title: 'Provider limit reached',
    message: expect.stringContaining('billing'),
  });
});

it('bounds unknown provider errors and preserves a fallback', () => {
  const error = presentProviderError('x'.repeat(5000));
  expect(error.message).toBe('The agent could not complete this turn.');
  expect(error.details).toHaveLength(2000);
  expect(presentProviderError().message).toBe('The agent could not complete this turn.');
});

it.each([
  [{ code: 401 }, 'authentication'],
  [{ code: 402 }, 'billing'],
  [{ code: 429 }, 'rate_limit'],
  [{ code: -32602 }, 'invalid_request'],
  [{ code: 'ECONNRESET' }, 'connection'],
  [{ code: 503 }, 'provider'],
  [{ code: -32000, data: { error: { code: 'insufficient_quota' } } }, 'billing'],
  [{ code: 429, message: 'Authentication required' }, 'rate_limit'],
  [{ code: 'unrecognized', message: 'Unknown problem' }, 'unknown'],
] as const)('classifies structured evidence %j as %s', (error, category) => {
  expect(classifyProviderError(error)).toBe(category);
});

it('redacts credentials and URL secrets from legacy details', () => {
  const clean = safeProviderErrorDetails(
    'Bearer private-token api_key=private-key https://user:pass@example.com/authorize?token=private-token',
  );
  expect(clean).not.toContain('private-token');
  expect(clean).not.toContain('private-key');
  expect(clean).not.toContain('user:pass');
  expect(clean).toContain('[redacted]');
});
