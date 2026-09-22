import { describe, expect, it } from 'vitest';
import { DEVELOPMENT_SESSION_KEY, DEVELOPMENT_SESSION_SALT, parseServerEnv } from './env-server.js';

describe('parseServerEnv', () => {
  it('allows the documented defaults outside production', () => {
    expect(parseServerEnv({}).NODE_ENV).toBe('development');
  });

  it('rejects development session secrets in production', () => {
    expect(() =>
      parseServerEnv({
        NODE_ENV: 'production',
        AGENTCTL_SESSION_KEY: DEVELOPMENT_SESSION_KEY,
        AGENTCTL_SESSION_SALT: DEVELOPMENT_SESSION_SALT,
      }),
    ).toThrow(/must be replaced in production/);
  });

  it('accepts unique production session secrets', () => {
    const env = parseServerEnv({
      NODE_ENV: 'production',
      AGENTCTL_SESSION_KEY: 'production-session-key-production-1234',
      AGENTCTL_SESSION_SALT: 'prod-salt-123456',
    });

    expect(env.NODE_ENV).toBe('production');
  });
});
