import type { ZodType } from 'zod';
import {
  capturedReviewFilesSchema,
  reviewFindingContinuitySchema,
  reviewContinuityReportSchema,
  reviewContextReportSchema,
  reviewWalkthroughSchema,
  walkthroughProgressSchema,
} from '@agentctl/shared';

function readSavedReviewJson<T>(schema: ZodType<T>, raw: string | null): T | null {
  if (!raw) return null;
  try {
    return schema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export const savedReviewFiles = (raw: string | null) =>
  readSavedReviewJson(capturedReviewFilesSchema, raw);

export const savedFindingContinuity = (raw: string | null) =>
  readSavedReviewJson(reviewFindingContinuitySchema, raw);

export const savedContinuityReport = (raw: string | null) =>
  readSavedReviewJson(reviewContinuityReportSchema, raw);

export const savedContext = (raw: string | null) =>
  readSavedReviewJson(reviewContextReportSchema, raw);

export const savedWalkthrough = (raw: string | null) =>
  readSavedReviewJson(reviewWalkthroughSchema, raw);

export const savedProgress = (raw: string | null) =>
  readSavedReviewJson(walkthroughProgressSchema, raw) ?? { position: 0, seen: [] };

export function savedEvidenceIds(raw: string | null): string[] {
  try {
    const value: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string').slice(0, 5)
      : [];
  } catch {
    return [];
  }
}
