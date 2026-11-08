import { describe, expect, it } from 'vite-plus/test';
import { jsonCodecs, sessionEventCodecs } from './json-codecs.js';

describe('jsonCodecs', () => {
  it('rejects malformed JSON and values with the wrong shape', () => {
    expect(jsonCodecs.stringArray('{')).toEqual([]);
    expect(jsonCodecs.stringArray('[1,2]')).toEqual([]);
    expect(jsonCodecs.stringRecord('["value"]')).toEqual({});
    expect(jsonCodecs.agentConfigOptionsOrNull('{"id":"model"}')).toBeNull();
  });

  it('decodes valid persisted values', () => {
    expect(jsonCodecs.agentSessionMap('{"provider":"session-1"}')).toEqual({
      provider: 'session-1',
    });
    expect(jsonCodecs.sessionMetrics('{"totalTokens":42}')).toEqual({ totalTokens: 42 });
  });
});

describe('sessionEventCodecs', () => {
  it('reads historical text and unknown event kinds', () => {
    expect(sessionEventCodecs.parseData('text', '"{\\"text\\":\\"legacy\\"}"')).toMatchObject({
      content: 'legacy',
    });
    expect(sessionEventCodecs.parseData('future_event', '{"future":true}')).toEqual({
      future: true,
    });
  });

  it('recovers malformed stored events and rejects invalid new writes', () => {
    expect(sessionEventCodecs.parseData('plan_update', '{"plan":42}')).toEqual({ plan: [] });
    expect(sessionEventCodecs.validateData('status', { field: 1 })).toEqual({ field: 1 });
    expect(() =>
      sessionEventCodecs.validateData('plan_update', JSON.parse('{"plan":42}')),
    ).toThrow();
  });
});
