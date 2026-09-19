import { describe, it, expect } from 'vitest';
import { createTaskSlug, formatSlugToTitle, validateApiKey } from './utils.js';

describe('createTaskSlug', () => {
  it('generates a memorable adjective-noun slug when no prefix is given', () => {
    const slug = createTaskSlug();
    expect(slug).toMatch(/^[a-z]+-[a-z]+$/);
  });

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

describe('formatSlugToTitle', () => {
  it('formats kebab-case and snake_case to capitalized title', () => {
    expect(formatSlugToTitle('swift-falcon')).toBe('Swift Falcon');
    expect(formatSlugToTitle('add_user_authentication')).toBe('Add User Authentication');
    expect(formatSlugToTitle('')).toBe('New Session');
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
