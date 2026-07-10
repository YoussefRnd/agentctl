export function parseArgumentsText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '[]';
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return trimmed;
  } catch {
    /* ignore parse errors */
  }
  const args = trimmed.split(/[\n,]+|\s+(?=(?:[^"]*"[^"]*")*[^"]*$)/).flatMap((arg) => {
    const clean = arg.trim().replace(/^"|"$/g, '');
    return clean ? [clean] : [];
  });
  return JSON.stringify(args);
}

export function formatArgumentsJson(jsonStr: string | null | undefined): string {
  if (!jsonStr) return '';
  try {
    const parsed = JSON.parse(jsonStr) as unknown;
    if (Array.isArray(parsed)) {
      return (parsed as unknown[])
        .map((arg) => {
          const str = String(arg);
          return str.includes(' ') ? `"${str}"` : str;
        })
        .join(' ');
    }
  } catch {
    /* ignore parse errors */
  }
  return jsonStr || '';
}

export function parseKeyValuesText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '{}';
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return trimmed;
  } catch {
    /* ignore parse errors */
  }
  const obj: Record<string, string> = {};
  const lines = trimmed.split('\n');
  for (const line of lines) {
    const cleanLine = line.trim();
    if (!cleanLine) continue;
    const delimiterIndex = cleanLine.includes('=')
      ? cleanLine.indexOf('=')
      : cleanLine.indexOf(':');
    if (delimiterIndex === -1) {
      obj[cleanLine] = '';
    } else {
      const key = cleanLine.substring(0, delimiterIndex).trim();
      const val = cleanLine.substring(delimiterIndex + 1).trim();
      obj[key] = val;
    }
  }
  return JSON.stringify(obj);
}

export function formatKeyValuesJson(jsonStr: string | null | undefined): string {
  if (!jsonStr) return '';
  try {
    const parsed = JSON.parse(jsonStr) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.entries(parsed as Record<string, unknown>)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join('\n');
    }
  } catch {
    /* ignore parse errors */
  }
  return jsonStr || '';
}

export function getToolOverride(
  toolPermissionsJson: string | null | undefined,
  toolName: string
): 'always_prompt' | 'auto_approve' | 'deny' | 'inherit' {
  if (!toolPermissionsJson) return 'inherit';
  try {
    const overrides = JSON.parse(toolPermissionsJson) as Record<string, unknown>;
    const val = overrides[toolName];
    if (val === 'always_prompt' || val === 'auto_approve' || val === 'deny' || val === 'inherit') {
      return val;
    }
  } catch {
    /* ignore parse errors */
  }
  return 'inherit';
}

export function updateToolOverride(
  toolPermissionsJson: string | null | undefined,
  toolName: string,
  val: 'always_prompt' | 'auto_approve' | 'deny' | 'inherit'
): string {
  let overridesMap: Record<string, string> = {};
  if (toolPermissionsJson) {
    try {
      const parsed = JSON.parse(toolPermissionsJson) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        overridesMap = parsed as Record<string, string>;
      } else {
        overridesMap = {};
      }
  } catch {
    /* ignore parse errors */
  }
  }

  if (val === 'inherit') {
    overridesMap = Object.fromEntries(
      Object.entries(overridesMap).filter(([k]) => k !== toolName),
    );
  } else {
    overridesMap[toolName] = val;
  }

  return JSON.stringify(overridesMap);
}

export interface McpFormState {
  name: string;
  type: 'local' | 'remote';
  command: string;
  args: string;
  env: string;
  url: string;
  headers: string;
  approvalPolicy: 'always_prompt' | 'auto_approve_all' | 'deny_all';
}

export const initialFormState: McpFormState = {
  name: '',
  type: 'local',
  command: '',
  args: '',
  env: '',
  url: '',
  headers: '',
  approvalPolicy: 'always_prompt',
};

export const approvalPolicyOptions = [
  { value: 'always_prompt', label: 'PROMPT USER' },
  { value: 'auto_approve_all', label: 'AUTO-APPROVE ALL' },
  { value: 'deny_all', label: 'DENY ALL' },
];
