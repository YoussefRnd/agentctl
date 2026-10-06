import { asRecord } from './tool-call-utils.js';
import type { ProviderRetryStatus } from '@agentctl/shared';

/** Optional namespaced extension hints; these never change execution or cause a retry. */
export function projectRetryMetadata(meta: unknown): { retry?: ProviderRetryStatus | null } {
  const entries = asRecord(meta);
  if (!entries) return {};
  for (const [key, value] of Object.entries(entries)) {
    if (!key.endsWith('/retry')) continue;
    if (value === null) return { retry: null };
    const retry = asRecord(value);
    const error = asRecord(retry?.error);
    if (
      !retry ||
      typeof retry.attempt !== 'number' ||
      !Number.isSafeInteger(retry.attempt) ||
      retry.attempt < 1 ||
      typeof retry.nextRetryAt !== 'string' ||
      !Number.isFinite(Date.parse(retry.nextRetryAt)) ||
      typeof error?.message !== 'string'
    )
      continue;
    return {
      retry: {
        attempt: retry.attempt,
        nextRetryAt: retry.nextRetryAt,
        message: error.message.slice(0, 512),
        ...(typeof error.status === 'number' &&
        Number.isInteger(error.status) &&
        error.status >= 100 &&
        error.status <= 599
          ? { httpStatus: error.status }
          : {}),
      },
    };
  }
  return {};
}
