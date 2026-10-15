import { expect, test } from 'vitest';
import { createSessionSchema, sessionRowSchema, thinkingEffortSchema } from './session.js';
import { sessionsContract } from '../contracts/sessions.contract.js';
import { providersContract } from '../contracts/providers.contract.js';

test.each(['none', 'thinking', 'default', 'xhigh', 'max', 'ultra', 'vendor-future-value'])(
  'accepts provider effort %s in creation, saved sessions, updates, and profile defaults',
  (value) => {
    expect(
      createSessionSchema.parse({
        projectId: '11111111-1111-4111-8111-111111111111',
        selectedThinkingEffort: value,
      }).selectedThinkingEffort,
    ).toBe(value);
    expect(
      sessionRowSchema.pick({ selectedThinkingEffort: true }).parse({
        selectedThinkingEffort: value,
      }).selectedThinkingEffort,
    ).toBe(value);
    expect(sessionsContract.patchSession.body.parse({ thinkingEffort: value }).thinkingEffort).toBe(
      value,
    );
    expect(
      providersContract.setProviderConfig.body.parse({
        defaultThinkingEffort: value,
      }).defaultThinkingEffort,
    ).toBe(value);
  },
);

test('supports no effort override and rejects missing, empty, and non-string efforts', () => {
  expect(thinkingEffortSchema.parse(null)).toBeNull();
  for (const value of [undefined, '', 1, false]) {
    expect(thinkingEffortSchema.safeParse(value).success).toBe(false);
  }
  expect(providersContract.setProviderConfig.body.parse({ defaultThinkingEffort: '' })).toEqual({
    defaultThinkingEffort: '',
  });
});
