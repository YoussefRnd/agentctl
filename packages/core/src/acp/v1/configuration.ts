import type { SessionConfigOption } from '@agentclientprotocol/sdk';
import { findAgentConfigOption, type AgentConfigOption } from '@agentctl/shared';
import { projectConfigOption } from '../protocol/events.js';

export function extractConfigOptionsFromSessionResult(sessionResult: {
  configOptions?: unknown;
  models?: {
    availableModels?: { modelId: string; name: string; description?: string | null }[];
    currentModelId?: string;
  } | null;
  modes?: {
    availableModes?: { id: string; name: string; description?: string | null }[];
    currentModeId?: string;
  } | null;
}): AgentConfigOption[] {
  const configOptions: AgentConfigOption[] = [];

  if (Array.isArray(sessionResult.configOptions) && sessionResult.configOptions.length > 0) {
    for (const opt of sessionResult.configOptions) {
      if (opt && typeof opt === 'object' && 'id' in opt && 'type' in opt) {
        configOptions.push(projectConfigOption(opt as SessionConfigOption));
      }
    }
  }

  const hasModelOption = !!findAgentConfigOption(configOptions, 'model');
  const models = sessionResult.models;
  if (!hasModelOption && models?.availableModels && models.availableModels.length > 0) {
    configOptions.push({
      id: 'model',
      category: 'model',
      name: 'Model',
      description: 'Select the model to use',
      type: 'select',
      currentValue: models.currentModelId ?? models.availableModels[0].modelId,
      options: models.availableModels.map((m) => ({
        value: m.modelId,
        name: m.name,
        description: m.description ?? undefined,
      })),
    });
  }

  const hasModeOption = !!findAgentConfigOption(configOptions, 'mode');
  const modesRes = sessionResult.modes;
  if (!hasModeOption && modesRes?.availableModes && modesRes.availableModes.length > 0) {
    configOptions.push({
      id: 'mode',
      category: 'mode',
      name: 'Mode',
      description: 'Select the tool approval mode',
      type: 'select',
      currentValue: modesRes.currentModeId ?? modesRes.availableModes[0].id,
      options: modesRes.availableModes.map((m) => ({
        value: m.id,
        name: m.name,
        description: m.description ?? undefined,
      })),
    });
  }

  return configOptions;
}
