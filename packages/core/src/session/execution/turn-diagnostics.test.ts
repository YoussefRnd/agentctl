import { expect, test } from 'vite-plus/test';
import { TurnDiagnostics } from './turn-diagnostics.js';

test('records each phase once and allows output before the acceptance response', () => {
  let now = 10;
  const diagnostics = new TurnDiagnostics(() => now);
  expect(diagnostics.observe({ type: 'text', text: 'background' })).toBeUndefined();
  now = 20;
  diagnostics.dispatch();
  now = 30;
  expect(diagnostics.observe({ type: 'text', text: 'reply' })).toBe('first_output');
  now = 40;
  expect(diagnostics.observe({ type: 'user_message_accepted', messageId: 'inserted' })).toBe(
    'prompt_accepted',
  );
  now = 50;
  expect(diagnostics.observe({ type: 'text', text: 'chunk' })).toBeUndefined();
  now = 60;
  expect(diagnostics.finish()).toEqual({
    preparationMs: 10,
    acceptanceMs: 20,
    firstOutputMs: 10,
    completionMs: 40,
  });
  now = 100;
  expect(diagnostics.observe({ type: 'text', text: 'late background' })).toBeUndefined();
  expect(diagnostics.finish().completionMs).toBe(40);
});

test('omits unknown acceptance and output phases, including v1 and rejected prompts', () => {
  let now = 0;
  const diagnostics = new TurnDiagnostics(() => now);
  now = 10;
  diagnostics.dispatch();
  diagnostics.observe({ type: 'user_text', text: 'echo' });
  diagnostics.observe({ type: 'text', text: '' });
  diagnostics.observe({ type: 'status', status: 'running' });
  now = 20;
  expect(diagnostics.finish()).toEqual({ preparationMs: 10, completionMs: 10 });
});
