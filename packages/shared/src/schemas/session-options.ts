import { z } from 'zod';
export const providerSchema = z.string().min(1);

export const sessionModeSchema = z.enum(['worktree', 'local']);

export const approvalModeSchema = z.enum(['review', 'auto_approve', 'yolo']);

/** Null means no provider reasoning override; non-null IDs are provider-defined. */
export const thinkingEffortSchema = z.string().min(1).nullable();

export type ProviderName = z.infer<typeof providerSchema>;
export type SessionMode = z.infer<typeof sessionModeSchema>;
export type ThinkingEffort = z.infer<typeof thinkingEffortSchema>;
export type ApprovalMode = z.infer<typeof approvalModeSchema>;
