import { describe, it, expect } from 'vite-plus/test';
import { redactSensitiveText } from './handoff.js';

describe('handoff redaction', () => {
  describe('redactSensitiveText', () => {
    it('redacts API keys and tokens', () => {
      // prettier-ignore
      const input = 'Here is my OpenAI key: sk-abc123xyz4567890123456 and token: ghp_123456789012345678901234567890123456';
      const output = redactSensitiveText(input);
      expect(output).not.toContain('sk-abc');
      expect(output).not.toContain('ghp_123');
      expect(output).toContain('[REDACTED_API_KEY]');
    });

    it('redacts Authorization bearer headers', () => {
      const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
      const output = redactSensitiveText(input);
      expect(output).toBe('Authorization: Bearer [REDACTED_TOKEN]');
    });
  });
});
