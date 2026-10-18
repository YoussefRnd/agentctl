import { describe, expect, it } from 'vite-plus/test';
import { authMethodSchema, registryAgentSchema, resolveAgentFeatures } from './registry.js';

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

describe('provider registry validation', () => {
  it('preserves legacy environment authentication metadata', () => {
    expect(
      authMethodSchema.parse({
        id: 'api_key',
        name: 'API key',
        type: 'env_var',
        vars: [{ name: 'PROVIDER_API_KEY' }],
      }),
    ).toMatchObject({
      type: 'env_var',
      vars: [{ name: 'PROVIDER_API_KEY', secret: true, optional: false }],
    });
  });

  it('rejects executable link schemes from registry metadata', () => {
    expect(() =>
      registryAgentSchema.parse({
        id: 'unsafe-links',
        name: 'Unsafe Links',
        version: '1.0.0',
        website: 'javascript:alert(1)',
        distribution: {},
      }),
    ).toThrow(/HTTP or HTTPS/);
  });
});
