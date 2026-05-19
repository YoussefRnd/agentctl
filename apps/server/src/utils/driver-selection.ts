import type { DriverDiscovery, ThinkingEffort } from '@agentctl/shared';

export interface DriverLaunchConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

const MODEL_OPTION_IDS = ['model', 'selectedModel'] as const;
const THINKING_OPTION_IDS = ['thinking', 'thinking_effort', 'selectedThinkingEffort'] as const;

function findConfigOption(driver: DriverDiscovery, ids: readonly string[]) {
  return (
    driver.configOptions?.find((option: NonNullable<DriverDiscovery['configOptions']>[number]) =>
      ids.includes(option.id),
    ) ?? undefined
  );
}

export function resolveDriverSelection(driver: DriverDiscovery): {
  selectedModel: string;
  selectedThinkingEffort: ThinkingEffort;
} {
  const modelOption = findConfigOption(driver, MODEL_OPTION_IDS);
  const thinkingOption = findConfigOption(driver, THINKING_OPTION_IDS);

  return {
    selectedModel: modelOption?.currentValue ?? modelOption?.options[0]?.value ?? 'default',
    selectedThinkingEffort: (thinkingOption?.currentValue ??
      thinkingOption?.options[0]?.value ??
      'medium') as ThinkingEffort,
  };
}

export function buildLaunchConfig(
  driver: Pick<DriverDiscovery, 'command' | 'launchArgs' | 'launchEnv'>,
  selectedModel: string,
  selectedThinkingEffort: string,
): DriverLaunchConfig {
  const extraArgs: string[] = [];

  if (selectedModel && selectedModel !== 'default') {
    extraArgs.push('--model', selectedModel);
  }

  if (selectedThinkingEffort) {
    extraArgs.push('--thinking-effort', selectedThinkingEffort);
  }

  return {
    command: driver.command,
    args: [...driver.launchArgs, ...extraArgs],
    env: driver.launchEnv,
  };
}
