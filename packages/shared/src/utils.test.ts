import { describe, it, expect } from 'vitest';
import {
  createTaskSlug,
  getSessionDisplayTitle,
  isDefaultSessionTitle,
  isPlaceholderSessionTitle,
  validateApiKey,
} from './utils.js';

describe('createTaskSlug', () => {
  it('generates a memorable adjective-noun slug when prefix is new-session', () => {
    const slug = createTaskSlug('new-session');
    expect(slug).toMatch(/^[a-z]+-[a-z]+$/);
    expect(slug).not.toBe('new-session');
  });

  it('normalizes and preserves custom task titles', () => {
    expect(createTaskSlug('Fix User Auth Modal')).toBe('fix-user-auth-modal');
    expect(createTaskSlug('refactor/api-routes')).toBe('refactor-api-routes');
    expect(createTaskSlug('  --special-chars!@#$%^&*-- ')).toBe('special-chars');
  });
});

describe('session titles', () => {
  it('recognizes placeholder and legacy generated titles', () => {
    expect(isPlaceholderSessionTitle('New Session')).toBe(true);
    expect(isPlaceholderSessionTitle('new-session')).toBe(true);
    expect(isDefaultSessionTitle('Mighty Wave', 'mighty-wave')).toBe(true);
    expect(isDefaultSessionTitle('Fix authentication', 'mighty-wave')).toBe(false);
  });

  it('hides a generated slug only for a draft without user activity', () => {
    expect(
      getSessionDisplayTitle({
        title: 'Mighty Wave',
        taskSlug: 'mighty-wave',
        hasUserActivity: false,
      }),
    ).toBe('New Session');
    expect(
      getSessionDisplayTitle({
        title: 'Mighty Wave',
        taskSlug: 'mighty-wave',
        hasUserActivity: true,
      }),
    ).toBe('Mighty Wave');
  });
});

describe('validateApiKey', () => {
  it('validates anthropic api keys', () => {
    expect(validateApiKey('ANTHROPIC_API_KEY', '')).toBe('API key is required');
    expect(validateApiKey('ANTHROPIC_API_KEY', 'short')).toBe(
      'Anthropic API key must start with "sk-ant-" or "sk-"',
    );
    expect(validateApiKey('ANTHROPIC_API_KEY', 'sk-ant-12345678901234567890')).toBeNull();
  });
});
