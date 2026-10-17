import type { ClientSideConnection, ForkSessionRequest } from '@agentclientprotocol/sdk';
import type { AcpParsedCapabilities } from '../types.js';
import { withTimeout } from '../transport/acp-process-lifecycle.js';

/** Only a definitive unsupported response permits falling back to a fresh session. */
export async function forkProviderSession(
  connection: Pick<ClientSideConnection, 'unstable_forkSession'>,
  capabilities: AcpParsedCapabilities,
  params: ForkSessionRequest,
  timeoutMs: number,
) {
  if (!capabilities.supportsForkSession) return null;
  let result;
  try {
    result = await withTimeout(
      connection.unstable_forkSession(params),
      timeoutMs,
      'forking agent session (outcome may be unknown; no automatic retry)',
    );
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === -32601) {
      return null;
    }
    // A timeout or transport error can happen after creation. Do not create a
    // second session or silently replace the requested provider context.
    throw error;
  }
  if (!result.sessionId || result.sessionId === params.sessionId) {
    throw new Error('Agent fork did not return a new session ID; no fallback session was created');
  }
  return result;
}
