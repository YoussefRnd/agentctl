import { RequestError } from '@agentclientprotocol/sdk';
import type { AgentAuthenticationOptions } from '../../agent/types.js';
import { waitForRequest, throwIfRequestCancelled } from './request-cancellation.js';

/** Only explicit HTTP(S) URL requests can be presented as browser authentication. */
export async function requestBrowserAuthentication(
  raw: unknown,
  options: AgentAuthenticationOptions,
): Promise<boolean> {
  if (!raw || typeof raw !== 'object' || !options.onBrowserRequest) return false;
  const value = raw as Record<string, unknown>;
  if (
    value.mode !== 'url' ||
    typeof value.url !== 'string' ||
    value.url.length > 32_768 ||
    typeof value.elicitationId !== 'string' ||
    !value.elicitationId ||
    value.elicitationId.length > 128
  )
    return false;
  try {
    if (!['http:', 'https:'].includes(new URL(value.url).protocol)) return false;
  } catch {
    return false;
  }
  throwIfRequestCancelled(options.signal);
  return waitForRequest(
    options.onBrowserRequest({
      id: value.elicitationId,
      url: value.url,
      message:
        typeof value.message === 'string'
          ? value.message.slice(0, 2048)
          : 'Open the sign-in page to continue.',
    }),
    options.signal,
  );
}

/** Restricted control connections offer URL consent and share request cancellation. */
export async function respondToBrowserAuthentication(
  raw: unknown,
  signal: AbortSignal,
  options: AgentAuthenticationOptions = {},
) {
  if (!raw || typeof raw !== 'object' || !('mode' in raw) || raw.mode !== 'url')
    throw RequestError.invalidParams(undefined, 'Control connections support URL elicitation only');
  const accepted = await requestBrowserAuthentication(raw, {
    ...options,
    signal: options.signal ? AbortSignal.any([options.signal, signal]) : signal,
  });
  return accepted ? { action: 'accept' as const } : { action: 'decline' as const };
}
