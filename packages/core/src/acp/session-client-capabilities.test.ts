import { describe, test, expect } from 'vitest';
import { parseAcpCapabilities } from './v1/capabilities.js';

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
      supportsForkSession: false,
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
      supportsForkSession: false,
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
      supportsForkSession: false,
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
        fork: {},
        resume: true,
        close: true,
        delete: true,
        list: true,
        additionalDirectories: true,
      },
    });

    expect(caps).toEqual({
      supportsForkSession: true,
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

describe('extractConfigOptionsFromSessionResult', () => {
  test('extracts models when configOptions is empty or missing', async () => {
    const { extractConfigOptionsFromSessionResult } = await import('./v1/configuration.js');
    const res = extractConfigOptionsFromSessionResult({
      models: {
        availableModels: [
          { modelId: 'gpt-4o', name: 'GPT-4o', description: 'Fast model' },
          { modelId: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet' },
        ],
        currentModelId: 'claude-3-5-sonnet',
      },
    });

    expect(res).toHaveLength(1);
    expect(res[0].id).toBe('model');
    expect(res[0].currentValue).toBe('claude-3-5-sonnet');
    expect(res[0].options).toHaveLength(2);
    expect(res[0].options?.[0].value).toBe('gpt-4o');
  });

  test('merges configOptions and models when both are returned by agent', async () => {
    const { extractConfigOptionsFromSessionResult } = await import('./v1/configuration.js');
    const res = extractConfigOptionsFromSessionResult({
      configOptions: [
        {
          id: 'thinking',
          name: 'Thinking Effort',
          type: 'select',
          currentValue: 'medium',
          options: [
            { value: 'low', name: 'Low' },
            { value: 'medium', name: 'Medium' },
          ],
        },
      ],
      models: {
        availableModels: [{ modelId: 'gemini-2.5-pro', name: 'Gemini Pro' }],
        currentModelId: 'gemini-2.5-pro',
      },
    });

    expect(res).toHaveLength(2);
    expect(res.find((o) => o.id === 'thinking')).toBeDefined();
    const modelOpt = res.find((o) => o.id === 'model');
    expect(modelOpt).toBeDefined();
    expect(modelOpt?.currentValue).toBe('gemini-2.5-pro');
  });

  test('does not duplicate model option if already present in configOptions', async () => {
    const { extractConfigOptionsFromSessionResult } = await import('./v1/configuration.js');
    const res = extractConfigOptionsFromSessionResult({
      configOptions: [
        {
          id: 'model',
          name: 'Model Selector',
          type: 'select',
          currentValue: 'custom-model',
          options: [{ value: 'custom-model', name: 'Custom' }],
        },
      ],
      models: {
        availableModels: [{ modelId: 'ignored-model', name: 'Ignored' }],
      },
    });

    expect(res).toHaveLength(1);
    expect(res[0].currentValue).toBe('custom-model');
  });
});
