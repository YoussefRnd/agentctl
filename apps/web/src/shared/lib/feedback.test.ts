import { expect, it } from 'vite-plus/test';
import { getErrorMessage } from './feedback';

it('preserves useful server messages and uses contextual copy for unknown or empty errors', () => {
  expect(getErrorMessage(new Error('Access denied'), 'Save failed')).toBe('Access denied');
  for (const error of [undefined, null, {}, 'internal failure', new Error(''), new Error('   ')]) {
    expect(getErrorMessage(error, 'Save failed')).toBe('Save failed');
  }
});
