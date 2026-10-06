import { getBestPermissionOption } from '../../security/permission-options.js';
import type { RequestPermissionRequest, RequestPermissionResponse } from '@agentclientprotocol/sdk';
import type { AgentPermissionRequest, AgentPermissionResponse } from '../../agent/types.js';
import { toolArgumentsFrom, toolNameFrom } from './tool-call-utils.js';

/**
 * Maps a raw ACP request_permission request into the domain shape used by
 * approval policy and the UI. Single canonical implementation.
 */
export function parsePermissionRequest(r: RequestPermissionRequest): AgentPermissionRequest {
  const toolCall = r.toolCall;
  const parsedArgs =
    toolArgumentsFrom(toolCall.rawInput) ??
    (() => {
      const primaryPath = toolCall.locations?.[0]?.path;
      if (primaryPath) {
        return {
          path: primaryPath,
          TargetFile: primaryPath,
          AbsolutePath: primaryPath,
        };
      }
      return undefined;
    })();

  return {
    permissionId: toolCall.toolCallId,
    source: 'provider',
    description: toolCall.title ?? undefined,
    options: r.options.map((opt) => ({
      optionId: opt.optionId,
      label: opt.name,
      kind: opt.kind,
    })),
    toolCall: {
      name: toolNameFrom(toolCall),
      arguments: parsedArgs,
      toolCallId: toolCall.toolCallId,
      kind: toolCall.kind ?? undefined,
      locations: toolCall.locations?.map((location) => ({
        path: location.path,
        line: location.line ?? undefined,
      })),
      rawInput: toolCall.rawInput,
    },
  };
}

export function formatPermissionOutcome(
  domainResp: AgentPermissionResponse,
  options: AgentPermissionRequest['options'],
): RequestPermissionResponse {
  if (domainResp.cancelled) return { outcome: { outcome: 'cancelled' } };
  const selectedOptionId =
    domainResp.optionId ??
    (domainResp.allowed
      ? getBestPermissionOption(options)
      : getBestPermissionOption(options, 'reject'));
  if (selectedOptionId && options?.some((option) => option.optionId === selectedOptionId)) {
    return {
      outcome: { outcome: 'selected', optionId: selectedOptionId },
    };
  }
  return { outcome: { outcome: 'cancelled' } };
}
