import { randomUUID } from 'node:crypto';
import type {
  BooleanPropertySchema,
  CreateElicitationRequest,
  CreateElicitationResponse,
  ElicitationContentValue,
  ElicitationFormMode,
  ElicitationPropertySchema,
  ElicitationUrlMode,
  IntegerPropertySchema,
  MultiSelectPropertySchema,
  NumberPropertySchema,
  StringPropertySchema,
} from '@agentclientprotocol/sdk';
import type {
  ElicitationFormField,
  ElicitationRequest,
  ElicitationResponse,
} from '@agentctl/shared';

function projectOptions(
  values: string[] | null | undefined,
  titled: { const: string; title: string; description?: string | null }[] | null | undefined,
) {
  if (titled) {
    return titled.map((option) => ({
      value: option.const,
      label: option.title,
      description: option.description ?? undefined,
    }));
  }
  return values?.map((value) => ({ value, label: value }));
}

function projectFormField(
  id: string,
  property: ElicitationPropertySchema,
  required: Set<string>,
): ElicitationFormField | null {
  const common = {
    id,
    label: typeof property.title === 'string' ? property.title : id,
    description: typeof property.description === 'string' ? property.description : undefined,
    required: required.has(id),
  };

  switch (property.type) {
    case 'string': {
      const stringProperty = property as StringPropertySchema;
      const options = projectOptions(stringProperty.enum, stringProperty.oneOf);
      return {
        ...common,
        type: options ? 'select' : 'string',
        default: stringProperty.default ?? undefined,
        minLength: stringProperty.minLength ?? undefined,
        maxLength: stringProperty.maxLength ?? undefined,
        pattern: stringProperty.pattern ?? undefined,
        format: stringProperty.format ?? undefined,
        options,
      };
    }
    case 'number':
    case 'integer': {
      const numberProperty = property as NumberPropertySchema | IntegerPropertySchema;
      return {
        ...common,
        type: property.type,
        default: numberProperty.default ?? undefined,
        minimum: numberProperty.minimum ?? undefined,
        maximum: numberProperty.maximum ?? undefined,
      };
    }
    case 'boolean': {
      const booleanProperty = property as BooleanPropertySchema;
      return {
        ...common,
        type: 'boolean',
        default: booleanProperty.default ?? undefined,
      };
    }
    case 'array': {
      const arrayProperty = property as MultiSelectPropertySchema;
      const items = arrayProperty.items as Record<string, unknown>;
      const titled = Array.isArray(items.anyOf)
        ? (items.anyOf as { const: string; title: string; description?: string | null }[])
        : undefined;
      const values = Array.isArray(items.enum)
        ? items.enum.filter((value): value is string => typeof value === 'string')
        : undefined;
      const options = projectOptions(values, titled);
      if (!options) return null;
      return {
        ...common,
        type: 'multi_select',
        default: arrayProperty.default ?? undefined,
        minItems: arrayProperty.minItems ?? undefined,
        maxItems: arrayProperty.maxItems ?? undefined,
        options,
      };
    }
    default:
      return null;
  }
}

/**
 * Converts the stabilized ACP elicitation wire shape into the UI/domain shape.
 * Unknown modes or field types are declined rather than rendered incorrectly.
 */
export function projectElicitationRequest(
  request: CreateElicitationRequest,
): ElicitationRequest | null {
  const scope = {
    sessionId:
      'sessionId' in request && typeof request.sessionId === 'string'
        ? request.sessionId
        : undefined,
    requestId:
      'requestId' in request &&
      (typeof request.requestId === 'string' || typeof request.requestId === 'number')
        ? request.requestId
        : undefined,
    toolCallId:
      'toolCallId' in request && typeof request.toolCallId === 'string'
        ? request.toolCallId
        : undefined,
  };

  if (request.mode === 'url') {
    const urlRequest = request as ElicitationUrlMode & { mode: 'url'; message: string };
    return {
      id: urlRequest.elicitationId,
      mode: 'url',
      message: request.message,
      ...scope,
      url: {
        url: urlRequest.url,
      },
    };
  }

  if (request.mode !== 'form') return null;

  const formRequest = request as ElicitationFormMode & { mode: 'form'; message: string };
  const schema = formRequest.requestedSchema;
  const required = new Set(schema.required ?? []);
  const fields: ElicitationFormField[] = [];
  for (const [id, property] of Object.entries(schema.properties ?? {})) {
    const field = projectFormField(id, property, required);
    if (!field) return null;
    fields.push(field);
  }

  return {
    id: randomUUID(),
    mode: 'form',
    message: request.message,
    ...scope,
    form: {
      title: schema.title ?? undefined,
      description: schema.description ?? undefined,
      fields,
    },
  };
}

function isValidFieldValue(field: ElicitationFormField, value: unknown): boolean {
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
      value.every(
        (entry) =>
          typeof entry === 'string' &&
          (field.options?.some((option) => option.value === entry) ?? false),
      ) &&
      (field.minItems === undefined || value.length >= field.minItems) &&
      (field.maxItems === undefined || value.length <= field.maxItems)
    );
  }
  if (typeof value !== 'string') return false;
  if (field.type === 'select') {
    return field.options?.some((option) => option.value === value) ?? false;
  }
  return (
    (field.minLength === undefined || value.length >= field.minLength) &&
    (field.maxLength === undefined || value.length <= field.maxLength)
  );
}

export function formatElicitationResponse(
  response: ElicitationResponse,
  request: ElicitationRequest,
): CreateElicitationResponse {
  if (response.action === 'decline') return { action: 'decline' };
  if (response.action === 'cancel') return { action: 'cancel' };

  const content: Record<string, ElicitationContentValue> = {};
  for (const field of request.form?.fields ?? []) {
    const value = response.values?.[field.id];
    if (value === undefined || value === null) {
      if (field.required) {
        throw new Error(`Missing required elicitation field: ${field.id}`);
      }
      continue;
    }
    if (!isValidFieldValue(field, value)) {
      throw new Error(`Invalid value for elicitation field: ${field.id}`);
    }
    content[field.id] = value as ElicitationContentValue;
  }
  return {
    action: 'accept',
    ...(Object.keys(content).length > 0 ? { content } : {}),
  };
}
