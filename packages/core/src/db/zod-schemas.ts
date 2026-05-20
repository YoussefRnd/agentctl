import type { z } from 'zod';
import { createSelectSchema } from 'drizzle-zod';
import { projects, sessions, drivers, acpEvents } from './schema.js';

export const projectRowSchema = createSelectSchema(projects);
export const sessionRowSchema = createSelectSchema(sessions);
export const driverRowSchema = createSelectSchema(drivers);
export const acpEventRowSchema = createSelectSchema(acpEvents);

export type ProjectRow = z.infer<typeof projectRowSchema>;
export type SessionRow = z.infer<typeof sessionRowSchema>;
export type DriverRow = z.infer<typeof driverRowSchema>;
export type ACPEventRow = z.infer<typeof acpEventRowSchema>;
