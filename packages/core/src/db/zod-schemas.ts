import type { z } from 'zod';
import { createSelectSchema } from 'drizzle-zod';
import {
  projects,
  sessions,
  providers,
  sessionEvents,
  systemSettings,
  mcpServers,
} from './schema.js';

export const projectRowSchema = createSelectSchema(projects);
export const sessionRowSchema = createSelectSchema(sessions);
export const providerRowSchema = createSelectSchema(providers);
export const sessionEventDbRowSchema = createSelectSchema(sessionEvents);
export const systemSettingRowSchema = createSelectSchema(systemSettings);
export const mcpServerRowSchema = createSelectSchema(mcpServers);

export type ProjectRow = z.infer<typeof projectRowSchema>;
export type SessionRow = z.infer<typeof sessionRowSchema>;
export type ProviderRow = z.infer<typeof providerRowSchema>;
export type SessionEventDbRow = z.infer<typeof sessionEventDbRowSchema>;
export type SystemSettingRow = z.infer<typeof systemSettingRowSchema>;
export type McpServerRow = z.infer<typeof mcpServerRowSchema>;
