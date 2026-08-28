import type { RequestPermissionRequest, RequestPermissionResponse } from '@agentclientprotocol/sdk';
import type { DomainPermissionRequest, DomainPermissionResponse } from '../types.js';
import { toolArgumentsFrom, toolNameFrom } from './tool-call-utils.js';

/**
 * Maps a raw ACP request_permission request into the domain shape used by
 * approval policy and the UI. Single canonical implementation.
 */
export function parsePermissionRequest(r: RequestPermissionRequest): DomainPermissionRequest {
  const toolCall = r.toolCall;
  const parsedArgs =
    toolArgumentsFrom(toolCall.rawInput) ??
    (() => {
      const primaryPath = toolCall.locations?.[0]?.path ?? toolCall.title ?? undefined;
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
    },
  };
}

export function formatPermissionOutcome(
  domainResp: DomainPermissionResponse,
  options: DomainPermissionRequest['options'],
): RequestPermissionResponse {
  const selectedOptionId =
    domainResp.optionId ??
    (domainResp.allowed
      ? getBestPermissionOption(options)
      : getBestPermissionOption(options, 'reject'));
  if (selectedOptionId) {
    return {
      outcome: { outcome: 'selected', optionId: selectedOptionId },
    };
  }
  return { outcome: { outcome: 'cancelled' } };
}

/**
 * Picks an allow-once or reject-once option from the agent-advertised options.
 * Persistent choices are a fallback and must only be preferred after an
 * explicit user selection.
 */
export function getBestPermissionOption(
  options?: DomainPermissionRequest['options'],
  decision: 'allow' | 'reject' = 'allow',
): string | undefined {
  if (!options || options.length === 0) return undefined;

  const preferredKinds =
    decision === 'allow'
      ? (['allow_once', 'allow_always'] as const)
      : (['reject_once', 'reject_always'] as const);
  for (const kind of preferredKinds) {
    const byKind = options.find((option) => option.kind === kind);
    if (byKind) return byKind.optionId;
  }

  const keywords =
    decision === 'allow'
      ? ['allow', 'approve', 'yes', 'grant', 'confirm', 'ok']
      : ['deny', 'reject', 'block', 'no'];
  const byLabel = options.find((option) => {
    const text = `${option.optionId} ${option.label ?? ''}`.toLowerCase();
    return keywords.some((keyword) => text.includes(keyword));
  });
  return byLabel?.optionId;
}

/**
 * Whether an option id signals a persistent grant (patterns should be stored).
 * Agent-native ids vary: allow_always, allow-always, allow_session, allow forever, ...
 */
export function isPersistentPermissionOption(optionId: string | undefined): boolean {
  if (!optionId) return false;
  const id = optionId.toLowerCase();
  return (
    id.includes('always') ||
    id.includes('session') ||
    id.includes('forever') ||
    id.includes('permanent')
  );
}
