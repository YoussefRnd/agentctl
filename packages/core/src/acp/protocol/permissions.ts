import type { RequestPermissionRequest, RequestPermissionResponse } from '@agentclientprotocol/sdk';
import type {
  DomainPermissionRequest,
  DomainPermissionResponse,
  PermissionToolCall,
} from '../types.js';

/**
 * Maps a raw ACP request_permission request into the domain shape used by
 * approval policy and the UI. Single canonical implementation.
 */
export function parsePermissionRequest(r: RequestPermissionRequest): DomainPermissionRequest {
  const toolCall = r.toolCall as unknown as PermissionToolCall;
  const rawInput = toolCall.rawInput as Record<string, unknown> | undefined;

  let parsedName = typeof toolCall.name === 'string' ? toolCall.name : '';
  if (!parsedName && toolCall.toolCallId) {
    parsedName = toolCall.toolCallId.split('__')[0];
  }
  if (!parsedName) {
    parsedName = typeof toolCall.kind === 'string' ? toolCall.kind : 'tool';
  }

  let parsedArgs = toolCall.arguments;
  if (!parsedArgs) {
    if (rawInput && typeof rawInput === 'object') {
      if (rawInput.arguments && typeof rawInput.arguments === 'object') {
        parsedArgs = rawInput.arguments as Record<string, unknown>;
      } else {
        const rest = { ...rawInput };
        delete rest.name;
        delete rest.arguments;
        parsedArgs = rest;
      }
    }
  }
  if (!parsedArgs) {
    const locations = toolCall.locations;
    const primaryPath =
      locations?.[0]?.path ?? (typeof toolCall.title === 'string' ? toolCall.title : undefined);
    if (primaryPath) {
      parsedArgs = {
        path: primaryPath,
        TargetFile: primaryPath,
        AbsolutePath: primaryPath,
      };
    }
  }

  return {
    permissionId: toolCall.toolCallId ?? '',
    description: typeof toolCall.title === 'string' ? toolCall.title : '',
    options: r.options.map((opt) => ({
      optionId: opt.optionId,
      label: opt.name,
      kind: opt.kind,
    })),
    toolCall: {
      name: parsedName,
      arguments: parsedArgs,
      toolCallId: toolCall.toolCallId,
    },
  };
}

export function formatPermissionOutcome(
  domainResp: DomainPermissionResponse,
): RequestPermissionResponse {
  if (domainResp.allowed && domainResp.optionId) {
    return {
      outcome: { outcome: 'selected', optionId: domainResp.optionId },
    };
  }
  return { outcome: { outcome: 'cancelled' } };
}

/**
 * Picks the most permissive option id from the agent-advertised options.
 */
export function getBestPermissionOption(
  options?: { optionId: string; label?: string }[],
): string | undefined {
  if (!options || options.length === 0) return undefined;

  const negativeKeywords = ['deny', 'cancel', 'reject', 'block', 'no'];
  const positiveOptions = options.filter((o) => {
    const id = o.optionId.toLowerCase();
    const label = (o.label ?? '').toLowerCase();
    return !negativeKeywords.some((neg) => id.includes(neg) || label.includes(neg));
  });

  if (positiveOptions.length === 0) {
    return options[0].optionId;
  }

  let best = positiveOptions.find((o) => {
    const id = o.optionId.toLowerCase();
    return id.includes('always') || id.includes('session') || id.includes('forever');
  });

  if (!best) {
    const positiveKeywords = ['allow', 'approve', 'yes', 'grant', 'confirm', 'ok'];
    best = positiveOptions.find((o) => {
      const id = o.optionId.toLowerCase();
      const label = (o.label ?? '').toLowerCase();
      return positiveKeywords.some((pos) => id.includes(pos) || label.includes(pos));
    });
  }

  best ??= positiveOptions[0];

  return best.optionId;
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
