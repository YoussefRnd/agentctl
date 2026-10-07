import { expect, it } from 'vitest';
import { summarize } from './measurements';
import { conversationFixture, markdownFixture } from './fixtures';
import { sessionEventRowSchema } from '@agentctl/shared';

it('reports percentiles without changing the input or inventing empty measurements', () => {
  const values = [8, 1, 3, 2];
  expect(summarize(values)).toEqual({ count: 4, p50: 2, p75: 3, p95: 8, max: 8 });
  expect(values).toEqual([8, 1, 3, 2]);
  expect(summarize([])).toBeNull();
});

it('creates deterministic bounded conversations with valid event shapes', () => {
  for (const tools of [1, 20]) {
    const events = conversationFixture(1000, tools);
    expect(events).toHaveLength(1000);
    expect(events).toEqual(conversationFixture(1000, tools));
    for (const event of events) expect(sessionEventRowSchema.parse(event)).toBeDefined();
  }
});

it('keeps long Markdown fixtures complete and includes Unicode, code and tables', () => {
  const text = markdownFixture('code-table', 32768);
  expect(text.length).toBeGreaterThanOrEqual(32768);
  expect(text.match(/```/g)!.length % 2).toBe(0);
  expect(text).toContain('👩🏽‍💻');
  expect(text).toContain('| File | Status | Change |');
});
