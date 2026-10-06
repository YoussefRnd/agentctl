import { ZodError } from 'zod';
import type { InitializeResponse } from '@agentclientprotocol/sdk/experimental/v2';
import { isAcpAuthenticationRequired } from './error-classifier.js';

export class AcpProtocolIncompatibilityError extends Error {}

/** Only initialization incompatibility may trigger a new process with v1. */
export async function negotiateV2(
  request: Promise<InitializeResponse>,
): Promise<InitializeResponse> {
  let response: InitializeResponse;
  try {
    response = await request;
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error ? Number(error.code) : undefined;
    const legacyShape =
      error instanceof ZodError &&
      error.issues.length > 0 &&
      error.issues.every(
        (issue) =>
          issue.path[0] === 'info' &&
          issue.code === 'invalid_type' &&
          issue.message.includes('undefined'),
      );
    const mismatch =
      error &&
      typeof error === 'object' &&
      'data' in error &&
      error.data &&
      typeof error.data === 'object' &&
      'expectedProtocolVersion' in error.data &&
      error.data.expectedProtocolVersion === 2;
    if (
      !isAcpAuthenticationRequired(error) &&
      (code === -32601 || code === -32602 || legacyShape || (code === -32600 && mismatch))
    ) {
      throw new AcpProtocolIncompatibilityError('Agent rejected ACP v2 initialization', {
        cause: error,
      });
    }
    throw error;
  }
  if (response.protocolVersion !== 2 || !response.info || 'agentCapabilities' in response) {
    throw new AcpProtocolIncompatibilityError(
      'Agent returned a legacy ACP initialization response',
    );
  }
  return response;
}
