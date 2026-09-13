import { describe, expect, it } from 'vitest';
import {
  isAcpAuthenticationRequired,
  isAcpMethodNotFound,
  isAcpSessionNotFound,
} from './error-classifier.js';

describe('ACP error classification', () => {
  it.each([
    [{ code: 'auth_required' }],
    [{ code: 'needs_auth' }],
    [{ message: 'Authentication required' }],
    ['Unauthorized'],
  ])('recognizes authentication failures', (error) => {
    expect(isAcpAuthenticationRequired(error)).toBe(true);
  });

  it.each([
    [{ code: -32002 }],
    [{ message: 'Session abc not found' }],
    [{ message: 'Session does not exist' }],
    [{ message: 'Resource not found' }],
  ])('recognizes missing sessions', (error) => {
    expect(isAcpSessionNotFound(error)).toBe(true);
  });

  it('recognizes method-not-found without conflating other errors', () => {
    expect(isAcpMethodNotFound({ code: -32601 })).toBe(true);
    expect(isAcpMethodNotFound({ code: -32002 })).toBe(false);
  });
});
