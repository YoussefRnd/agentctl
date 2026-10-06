import { describe, expect, it } from 'vitest';
import { getElicitationValidationError } from './elicitation-validation.js';
import type { ElicitationFormField, ElicitationRequest } from './schemas/session.js';

function validate(field: Partial<ElicitationFormField>, value: unknown) {
  const request: ElicitationRequest = {
    id: 'form',
    mode: 'form',
    message: 'Enter value',
    form: { fields: [{ id: 'value', label: 'Value', type: 'string', required: true, ...field }] },
  };
  return getElicitationValidationError(request, { action: 'submit', values: { value } });
}

describe('elicitation response constraints', () => {
  it.each([
    [{ pattern: '^[A-Z]+$' }, 'wrong'],
    [{ pattern: '[' }, 'anything'],
    [{ format: 'email' }, 'not-an-email'],
    [{ format: 'uri' }, '/relative'],
    [{ format: 'date' }, '2025-02-30'],
    [{ format: 'date-time' }, 'tomorrow'],
    [{ type: 'integer' }, 1.5],
    [{ type: 'multi_select', options: [{ label: 'A', value: 'a' }] }, ['a', 'a']],
  ] as const)('rejects a response violating %j', (field, value) => {
    expect(validate(field as Partial<ElicitationFormField>, value)).toContain('Invalid value');
  });
  it.each([
    [{ pattern: '^[A-Z]+$' }, 'YES'],
    [{ format: 'email' }, 'user@example.com'],
    [{ format: 'uri' }, 'mailto:user@example.com'],
    [{ format: 'date' }, '2024-02-29'],
    [{ format: 'date-time' }, '2026-10-04T10:15:00+01:00'],
    [{ minLength: 1, maxLength: 1 }, '😀'],
  ] as const)('accepts a response meeting %j', (field, value) => {
    expect(validate(field, value)).toBeUndefined();
  });
});
