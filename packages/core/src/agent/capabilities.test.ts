import { describe, expect, it } from 'vitest';
import { driverCapabilities, resolveProviderSelection, listDriverCapabilities } from './capabilities.js';

describe('driver capabilities', () => {
  it('lists static capabilities for each supported driver', () => {
    expect(listDriverCapabilities()).toHaveLength(4);
    expect(driverCapabilities['claude-code'].command).toBe('claude');
  });

  it('falls back to the first supported model and effort when the selection is invalid', () => {
    expect(resolveProviderSelection({
      selectedDriver: 'claude-code',
      selectedModel: 'unknown-model',
      selectedThinkingEffort: 'extreme',
    })).toEqual({
      selectedDriver: 'claude-code',
      selectedModel: 'sonnet-4',
      selectedThinkingEffort: 'low',
    });
  });
});
