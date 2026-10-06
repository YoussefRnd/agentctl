import { z } from 'zod';
import type {
  ElicitationFormField,
  ElicitationRequest,
  ElicitationResponse,
} from './schemas/session.js';

function validFieldValue(field: ElicitationFormField, value: unknown): boolean {
  if (field.type === 'boolean') return typeof value === 'boolean';
  if (field.type === 'number' || field.type === 'integer') {
    return (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      (field.type !== 'integer' || Number.isInteger(value)) &&
      (field.minimum === undefined || value >= field.minimum) &&
      (field.maximum === undefined || value <= field.maximum)
    );
  }
  if (field.type === 'multi_select') {
    return (
      Array.isArray(value) &&
      new Set(value).size === value.length &&
      value.every(
        (entry) =>
          typeof entry === 'string' && field.options?.some((option) => option.value === entry),
      ) &&
      (field.minItems === undefined || value.length >= field.minItems) &&
      (field.maxItems === undefined || value.length <= field.maxItems)
    );
  }
  if (typeof value !== 'string') return false;
  if (field.type === 'select')
    return field.options?.some((option) => option.value === value) ?? false;
  const length = Array.from(value).length;
  if (
    (field.minLength !== undefined && length < field.minLength) ||
    (field.maxLength !== undefined && length > field.maxLength)
  )
    return false;
  if (field.pattern !== undefined) {
    try {
      if (!new RegExp(field.pattern, 'u').test(value)) return false;
    } catch {
      return false;
    }
  }
  switch (field.format) {
    case 'email':
      return z.email().safeParse(value).success;
    case 'uri':
      return z.url().safeParse(value).success;
    case 'date':
      return z.iso.date().safeParse(value).success;
    case 'date-time':
      return z.iso.datetime({ offset: true }).safeParse(value).success;
    default:
      return true;
  }
}

/** Validate before settling the request so the user can correct an invalid form. */
export function getElicitationValidationError(
  request: ElicitationRequest,
  response: ElicitationResponse,
): string | undefined {
  if (response.action !== 'submit' || request.mode !== 'form') return undefined;
  for (const field of request.form?.fields ?? []) {
    const value = response.values?.[field.id];
    if (value === undefined || value === null) {
      if (field.required) return `Missing required elicitation field: ${field.id}`;
    } else if (!validFieldValue(field, value)) {
      return `Invalid value for elicitation field: ${field.id}`;
    }
  }
  return undefined;
}
