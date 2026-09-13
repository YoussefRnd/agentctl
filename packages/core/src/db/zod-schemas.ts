import type { z } from 'zod';
import { createSelectSchema } from 'drizzle-zod';
import { projects, sessions, providers, acpEvents, systemSettings, mcpServers } from './schema.js';

export const projectRowSchema = createSelectSchema(projects);
export const sessionRowSchema = createSelectSchema(sessions);
export const providerRowSchema = createSelectSchema(providers);
export const acpEventDbRowSchema = createSelectSchema(acpEvents);
export const systemSettingRowSchema = createSelectSchema(systemSettings);
export const mcpServerRowSchema = createSelectSchema(mcpServers);

export type ProjectRow = z.infer<typeof projectRowSchema>;
export type SessionRow = z.infer<typeof sessionRowSchema>;
export type ProviderRow = z.infer<typeof providerRowSchema>;
export type SessionEventDbRow = z.infer<typeof acpEventDbRowSchema>;
/** @deprecated Use SessionEventDbRow. */
export type ACPEventDbRow = SessionEventDbRow;
export type SystemSettingRow = z.infer<typeof systemSettingRowSchema>;
export type McpServerRow = z.infer<typeof mcpServerRowSchema>;
