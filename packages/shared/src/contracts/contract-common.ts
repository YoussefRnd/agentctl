import { z } from 'zod';
export const emptyBodySchema = z.record(z.string(), z.unknown()).optional().default({});
