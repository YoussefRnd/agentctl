export type DriverName = 'claude-code' | 'gemini-cli' | 'opencode' | 'codex-acp';
export type ThinkingEffort = 'low' | 'medium' | 'high';

export interface DriverCapability {
  driver: DriverName;
  label: string;
  command: string;
  models: string[];
  thinkingEfforts: ThinkingEffort[];
  buildArgs: (model: string, effort: ThinkingEffort) => string[];
};

export const driverCapabilities: Record<DriverCapability['driver'], DriverCapability> = {
  'claude-code': {
    driver: 'claude-code',
    label: 'Claude Code',
    command: 'claude',
    models: ['sonnet-4', 'opus-4'],
    thinkingEfforts: ['low', 'medium', 'high'],
    buildArgs: (_model, _effort) => ['--acp'],
  },
  'gemini-cli': {
    driver: 'gemini-cli',
    label: 'Gemini CLI',
    command: 'gemini',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash'],
    thinkingEfforts: ['low', 'medium', 'high'],
    buildArgs: (model, effort) => ['--acp', '--model', model, '--thinking', effort],
  },
  opencode: {
    driver: 'opencode',
    label: 'OpenCode',
    command: 'opencode',
    models: ['default'],
    thinkingEfforts: ['low', 'medium', 'high'],
    buildArgs: (model, effort) => ['--acp', '--model', model, '--thinking', effort],
  },
  'codex-acp': {
    driver: 'codex-acp',
    label: 'Codex ACP',
    command: 'codex',
    models: ['default'],
    thinkingEfforts: ['low', 'medium', 'high'],
    buildArgs: (model, effort) => ['--acp', '--model', model, '--thinking', effort],
  },
};

export function listDriverCapabilities() {
  return Object.values(driverCapabilities);
}

export function getDriverCapability(driver: string) {
  return driver in driverCapabilities ? driverCapabilities[driver as DriverName] : null;
}

export function resolveProviderSelection(selection: {
  selectedDriver: string;
  selectedModel?: string | null;
  selectedThinkingEffort?: string | null;
}) {
  const capability = getDriverCapability(selection.selectedDriver) ?? driverCapabilities['claude-code'];
  const selectedModel = selection.selectedModel && capability.models.includes(selection.selectedModel)
    ? selection.selectedModel
    : capability.models[0];
  const effort = selection.selectedThinkingEffort;

  return {
    selectedDriver: capability.driver,
    selectedModel,
    selectedThinkingEffort: effort && capability.thinkingEfforts.includes(effort as ThinkingEffort)
      ? effort as ThinkingEffort
      : capability.thinkingEfforts[0],
  };
}
