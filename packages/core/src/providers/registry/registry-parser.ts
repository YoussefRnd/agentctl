import { registrySchema, type RegistryAgent } from '@agentctl/shared';

export function parseRegistryAgents(data: string): RegistryAgent[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch (cause) {
    throw new Error('Registry snapshot contains invalid JSON. Run a registry sync and try again.', {
      cause,
    });
  }

  const validated = registrySchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(
      `Registry snapshot failed validation. Run a registry sync and try again: ${validated.error.message}`,
    );
  }

  return validated.data.agents;
}
