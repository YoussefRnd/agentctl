import { expect, test } from 'vite-plus/test';
import { isAcpAuthenticationRequired } from './error-classifier.js';

test('recognizes the standard authentication error code independently of its message', () => {
  expect(isAcpAuthenticationRequired({ code: -32000, message: 'Please log in' })).toBe(true);
  expect(isAcpAuthenticationRequired({ code: '-32000', message: 'Connect account' })).toBe(true);
  expect(isAcpAuthenticationRequired({ code: -32603, message: 'Internal error' })).toBe(false);
});
