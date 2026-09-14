import { z } from 'zod';
import { agentFeaturesSchema } from './registry.js';

export const agentDiagnosticAdapterSchema = z.enum(['acp-v1', 'acp-v2']);
export const agentDiagnosticEventKindSchema = z.enum([
  'adapter_selected',
  'connection_starting',
  'connection_ready',
  'connection_reused',
  'connection_closed',
  'connection_exited',
  'fallback_used',
  'session_started',
]);

export const agentDiagnosticEventSchema = z.object({
  timestamp: z.string(),
  kind: agentDiagnosticEventKindSchema,
  adapter: agentDiagnosticAdapterSchema,
  providerId: z.string().optional(),
  generation: z.number().optional(),
  intent: z.enum(['new', 'resume', 'fork']).optional(),
  path: z
    .enum(['persistent', 'spawn', 'provider_fork', 'provider_resume', 'fresh_session'])
    .optional(),
  reason: z
    .enum([
      'persistent_connection_unavailable',
      'fork_not_supported',
      'fork_method_not_found',
      'session_not_found',
      'idle_timeout',
      'provider_closed',
      'process_exit',
    ])
    .optional(),
  features: agentFeaturesSchema.optional(),
});

export const agentConnectionDiagnosticSchema = z.object({
  adapter: agentDiagnosticAdapterSchema,
  providerId: z.string(),
  generation: z.number(),
  state: z.literal('ready'),
  activeSessionCount: z.number(),
  lastUsedAt: z.string(),
  features: agentFeaturesSchema,
});

export const agentDiagnosticsSnapshotSchema = z.object({
  generatedAt: z.string(),
  connections: z.array(agentConnectionDiagnosticSchema),
  events: z.array(agentDiagnosticEventSchema),
});

export type AgentDiagnosticAdapter = z.infer<typeof agentDiagnosticAdapterSchema>;
export type AgentDiagnosticEventKind = z.infer<typeof agentDiagnosticEventKindSchema>;
export type AgentDiagnosticEvent = z.infer<typeof agentDiagnosticEventSchema>;
export type AgentConnectionDiagnostic = z.infer<typeof agentConnectionDiagnosticSchema>;
export type AgentDiagnosticsSnapshot = z.infer<typeof agentDiagnosticsSnapshotSchema>;
