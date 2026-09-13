import { describe, expect, it } from 'vitest';
import { jsonCodecs } from './json-codecs.js';

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
