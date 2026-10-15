import { authMethodSchema } from '@agentctl/shared';
import type { AgentDescriptor } from '../../agent/types.js';

/** Translate authentication once at the wire boundary, including v2 env arrays. */
export function projectAuthMethods(
  methods: readonly unknown[],
  version: 1 | 2,
): AgentDescriptor['authMethods'] {
  return methods.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const method = value as Record<string, unknown>;
    if (method.type !== undefined && method.type !== 'agent' && method.type !== 'terminal')
      return [];
    const terminal = method.type === 'terminal';
    if (terminal && version === 2 && Array.isArray(method.env)) {
      const names = method.env.map((entry: { name: string }) => entry.name);
      if (new Set(names).size !== names.length)
        throw new Error('Agent returned duplicate authentication environment names');
    }
    const env =
      terminal && version === 2 && Array.isArray(method.env)
        ? Object.fromEntries(
            method.env.map((entry: { name: string; value: string }) => [entry.name, entry.value]),
          )
        : method.env;
    const result = authMethodSchema.safeParse({
      id: version === 2 ? method.methodId : method.id,
      name: method.name,
      type: terminal ? 'terminal' : 'agent',
      description: method.description ?? null,
      ...(terminal ? { args: method.args, env } : {}),
    });
    if (!result.success) throw new Error('Agent returned an invalid authentication method');
    return [result.data];
  });
}
