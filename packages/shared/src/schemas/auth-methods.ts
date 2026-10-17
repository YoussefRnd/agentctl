import { z } from 'zod';
export const environmentVariableNameSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Invalid environment variable name');

export const authEnvVarSchema = z.object({
  name: environmentVariableNameSchema,
  label: z.string().optional(),
  secret: z.boolean().default(true),
  optional: z.boolean().default(false),
});

export const authMethodTerminalSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.literal('terminal'),
  description: z.string().nullable().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(environmentVariableNameSchema, z.string()).optional(),
  _meta: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const authMethodAgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.literal('agent').default('agent'),
  description: z.string().nullable().optional(),
  _meta: z.record(z.string(), z.unknown()).nullable().optional(),
});

/** Legacy registry authentication for agents that still read credentials from env. */
export const authMethodEnvVarSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.literal('env_var'),
  description: z.string().nullable().optional(),
  vars: z.array(authEnvVarSchema).min(1),
  _meta: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const authMethodSchema = z.preprocess(
  (val: unknown) => {
    if (typeof val === 'object' && val !== null) {
      const obj = val as Record<string, unknown>;
      const id = (obj.id ?? obj.methodId) as string | undefined;
      const type =
        obj.type === 'terminal' ? 'terminal' : obj.type === 'env_var' ? 'env_var' : 'agent';
      return { ...obj, id, type };
    }
    return val;
  },
  z.discriminatedUnion('type', [
    authMethodAgentSchema,
    authMethodTerminalSchema,
    authMethodEnvVarSchema,
  ]),
);

export type AuthMethodTerminal = z.infer<typeof authMethodTerminalSchema>;
export type AuthMethodAgent = z.infer<typeof authMethodAgentSchema>;
export type AuthMethodEnvVar = z.infer<typeof authMethodEnvVarSchema>;
export type AuthMethod = z.infer<typeof authMethodSchema>;
