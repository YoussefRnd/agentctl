import { describe, expect, it } from 'vite-plus/test';
import { toolArgumentsFrom, toolNameFrom } from './tool-call-utils.js';

describe('toolArgumentsFrom', () => {
  it('extracts arguments from standard nested arguments object', () => {
    expect(toolArgumentsFrom({ name: 'task', arguments: { prompt: 'do work' } })).toEqual({
      prompt: 'do work',
    });
  });

  it('extracts arguments from flat object', () => {
    expect(toolArgumentsFrom({ prompt: 'do work', task: 'run' })).toEqual({
      prompt: 'do work',
      task: 'run',
    });
  });

  it('extracts arguments from stringified rawInput JSON', () => {
    expect(toolArgumentsFrom('{"prompt": "do work"}')).toEqual({
      prompt: 'do work',
    });
    expect(toolArgumentsFrom('{"name": "task", "arguments": {"prompt": "do work"}}')).toEqual({
      prompt: 'do work',
    });
  });

  it('extracts arguments from stringified input.arguments', () => {
    expect(toolArgumentsFrom({ name: 'task', arguments: '{"prompt": "do work"}' })).toEqual({
      prompt: 'do work',
    });
    expect(
      toolArgumentsFrom('{"name": "task", "arguments": "{\\"prompt\\": \\"do work\\"}"}'),
    ).toEqual({
      prompt: 'do work',
    });
  });

  it('returns undefined for invalid or empty inputs', () => {
    expect(toolArgumentsFrom(null)).toBeUndefined();
    expect(toolArgumentsFrom(undefined)).toBeUndefined();
    expect(toolArgumentsFrom('not json')).toBeUndefined();
    expect(toolArgumentsFrom(123)).toBeUndefined();
  });
});

describe('toolNameFrom', () => {
  it('prefers explicit name', () => {
    expect(toolNameFrom({ toolCallId: 'call-1', name: 'my_tool' })).toBe('my_tool');
  });

  it('extracts name from rawInput object', () => {
    expect(toolNameFrom({ toolCallId: 'call-1', rawInput: { name: 'task' } })).toBe('task');
  });

  it('extracts name from rawInput stringified JSON', () => {
    expect(toolNameFrom({ toolCallId: 'call-1', rawInput: '{"name": "task"}' })).toBe('task');
  });

  it('falls back to kind and title', () => {
    expect(toolNameFrom({ toolCallId: 'call-1', kind: 'execute' })).toBe('execute');
    expect(toolNameFrom({ toolCallId: 'call-1', title: 'Run command' })).toBe('Run command');
    expect(toolNameFrom({ toolCallId: 'call-1' })).toBe('tool');
  });
});
