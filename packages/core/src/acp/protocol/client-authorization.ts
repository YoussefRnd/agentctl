import { randomUUID } from 'node:crypto';
import { RequestError } from '@agentclientprotocol/sdk';
import type { AgentPermissionRequest, AgentSessionCallbacks } from '../../agent/types.js';
import { throwIfRequestCancelled, waitForRequest } from './request-cancellation.js';

export interface ClientAuthorizationContext {
  callbacks: AgentSessionCallbacks;
  cwd: string;
  additionalDirectories?: string[];
}

/** All operations executed by the client use the same session approval policy. */
export async function authorizeClientOperation(
  session: ClientAuthorizationContext,
  toolCall: AgentPermissionRequest['toolCall'],
  description: string,
  signal?: AbortSignal,
): Promise<void> {
  throwIfRequestCancelled(signal);
  const response = await waitForRequest(
    session.callbacks.onRequestPermission(
      {
        permissionId: randomUUID(),
        source: 'client',
        description,
        toolCall,
        options: [
          { optionId: 'allow_once', kind: 'allow_once', label: 'Approve once' },
          {
            optionId: 'allow_session',
            kind: 'allow_always',
            label: 'Allow this exact action for this session',
          },
          { optionId: 'reject_once', kind: 'reject_once', label: 'Deny' },
          {
            optionId: 'reject_session',
            kind: 'reject_always',
            label: 'Deny this exact action for this session',
          },
        ],
      },
      signal,
    ),
    signal,
  );
  throwIfRequestCancelled(signal);
  if (response.cancelled) throw RequestError.requestCancelled();
  if (!response.allowed) {
    throw RequestError.internalError(undefined, `Permission was not granted for ${toolCall.name}.`);
  }
}
