import { describe, test, expect } from 'vitest';
import { parseAcpCapabilities } from './transport/capabilities-cache.js';

describe('parseAcpCapabilities', () => {
  test('parses loadSession when top-level loadSession is true', () => {
    const caps = parseAcpCapabilities({ loadSession: true });
    expect(caps.supportsLoadSession).toBe(true);
    expect(caps.supportsResumeSession).toBe(false);
  });

  test('keeps load and resume capabilities independent', () => {
    const caps = parseAcpCapabilities({
      sessionCapabilities: { load: true, resume: true },
    });
    expect(caps.supportsLoadSession).toBe(false);
    expect(caps.supportsResumeSession).toBe(true);
  });

  test('returns false for supportsLoadSession when no load/resume capability exists', () => {
    const caps = parseAcpCapabilities({
      sessionCapabilities: { close: true, delete: true },
    });
    expect(caps.supportsLoadSession).toBe(false);
    expect(caps.supportsResumeSession).toBe(false);
    expect(caps.supportsCloseSession).toBe(true);
    expect(caps.supportsDeleteSession).toBe(true);
  });

  test('handles empty or undefined agentCapabilities gracefully', () => {
    expect(parseAcpCapabilities(undefined)).toEqual({
      supportsResumeSession: false,
      supportsCloseSession: false,
      supportsDeleteSession: false,
      supportsListSessions: false,
      supportsAdditionalDirectories: false,
      supportsLoadSession: false,
      supportsImage: false,
      supportsAudio: false,
      supportsEmbeddedContext: false,
    });

    expect(parseAcpCapabilities(null)).toEqual({
      supportsResumeSession: false,
      supportsCloseSession: false,
      supportsDeleteSession: false,
      supportsListSessions: false,
      supportsAdditionalDirectories: false,
      supportsLoadSession: false,
      supportsImage: false,
      supportsAudio: false,
      supportsEmbeddedContext: false,
    });

    expect(parseAcpCapabilities({})).toEqual({
      supportsResumeSession: false,
      supportsCloseSession: false,
      supportsDeleteSession: false,
      supportsListSessions: false,
      supportsAdditionalDirectories: false,
      supportsLoadSession: false,
      supportsImage: false,
      supportsAudio: false,
      supportsEmbeddedContext: false,
    });
  });

  test('correctly parses all capability fields', () => {
    const caps = parseAcpCapabilities({
      loadSession: true,
      promptCapabilities: { image: true, audio: true, embeddedContext: true },
      sessionCapabilities: {
        resume: true,
        close: true,
        delete: true,
        list: true,
        additionalDirectories: true,
      },
    });

    expect(caps).toEqual({
      supportsResumeSession: true,
      supportsCloseSession: true,
      supportsDeleteSession: true,
      supportsListSessions: true,
      supportsAdditionalDirectories: true,
      supportsLoadSession: true,
      supportsImage: true,
      supportsAudio: true,
      supportsEmbeddedContext: true,
    });
  });
});
