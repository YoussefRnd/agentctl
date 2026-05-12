import { describe, it, expect } from 'vitest';
import { parseEnv, parseWebEnv } from './env.js';

describe('Environment variable parsing', () => {
  describe('parseEnv (Server)', () => {
    it('uses defaults when env is empty', () => {
      const env = parseEnv({});
      expect(env.AGENTCTL_SECRET).toBe('dev-secret');
      expect(env.PORT).toBe(3000);
      expect(env.DATABASE_URL).toBe('sqlite.db');
    });

    it('parses correct values', () => {
      const env = parseEnv({
        AGENTCTL_SECRET: 'super-secret',
        PORT: '4000',
        DATABASE_URL: 'postgres://localhost/db',
      });
      expect(env.AGENTCTL_SECRET).toBe('super-secret');
      expect(env.PORT).toBe(4000);
      expect(env.DATABASE_URL).toBe('postgres://localhost/db');
    });

    it('throws error for missing or empty secret if overridden incorrectly', () => {
      expect(() => parseEnv({ AGENTCTL_SECRET: '' })).toThrow();
    });

    it('throws error for non-numeric port string', () => {
      expect(() => parseEnv({ PORT: 'not-a-number' })).toThrow();
    });
  });

  describe('parseWebEnv (Web)', () => {
    it('uses defaults when env is empty', () => {
      const env = parseWebEnv({});
      expect(env.VITE_AGENTCTL_SECRET).toBe('dev-secret');
      expect(env.VITE_API_URL).toBe('http://localhost:3000');
    });

    it('parses correct values', () => {
      const env = parseWebEnv({
        VITE_AGENTCTL_SECRET: 'web-secret',
        VITE_API_URL: 'https://api.example.com',
      });
      expect(env.VITE_AGENTCTL_SECRET).toBe('web-secret');
      expect(env.VITE_API_URL).toBe('https://api.example.com');
    });

    it('throws error for empty secret', () => {
      expect(() => parseWebEnv({ VITE_AGENTCTL_SECRET: '' })).toThrow();
    });

    it('throws error for invalid url format (must start with http)', () => {
      expect(() => parseWebEnv({ VITE_API_URL: 'ftp://localhost' })).toThrow();
    });
  });
});
