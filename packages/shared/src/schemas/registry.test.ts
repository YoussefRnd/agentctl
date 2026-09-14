import { describe, expect, it } from 'vitest';
import { resolveAgentFeatures } from './registry.js';

describe('resolveAgentFeatures', () => {
  it('uses canonical features and accepts legacy configuration flags', () => {
    expect(resolveAgentFeatures({ supportsDynamicConfig: true })).toMatchObject({
      configuration: { model: false, options: true },
      prompts: { image: false },
    });
    expect(
      resolveAgentFeatures({
        features: {
          sessions: { resume: true, fork: true, delete: false, list: true },
          prompts: { image: true, audio: false, embeddedContext: false },
          configuration: { model: true, options: false },
          authentication: { logout: true },
        },
        supportsDynamicConfig: true,
      }),
    ).toMatchObject({
      sessions: { resume: true, fork: true },
      prompts: { image: true },
      configuration: { model: true, options: false },
      authentication: { logout: true },
    });
  });
});
