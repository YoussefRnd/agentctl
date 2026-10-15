import type { RequestPermissionRequest } from '@agentclientprotocol/sdk/experimental/v2';
import type { AgentPermissionRequest } from '../../agent/types.js';
import { toolArgumentsFrom } from '../protocol/tool-call-utils.js';

export function toPermissionRequest(
  request: RequestPermissionRequest,
  permissionId: string,
): AgentPermissionRequest {
  const options = request.options.map((option) => ({
    optionId: option.optionId,
    label: option.name,
    kind: option.kind,
  }));
  const subject = request.subject;
  const common = {
    permissionId,
    source: 'provider' as const,
    subject,
    description: request.description ?? request.title,
    options,
  };
  if (subject?.type === 'tool_call' && 'toolCall' in subject) {
    const call = subject.toolCall as {
      name?: unknown;
      title?: unknown;
      rawInput?: unknown;
      toolCallId?: unknown;
      kind?: unknown;
      locations?: { path: string; line?: number | null }[] | null;
    };
    return {
      ...common,
      toolCall: {
        name:
          typeof call.name === 'string'
            ? call.name
            : typeof call.title === 'string'
              ? call.title
              : request.title,
        arguments: toolArgumentsFrom(call.rawInput),
        rawInput: call.rawInput,
        kind: typeof call.kind === 'string' ? call.kind : undefined,
        locations: call.locations?.map((location) => ({
          path: location.path,
          line: location.line ?? undefined,
        })),
        toolCallId: typeof call.toolCallId === 'string' ? call.toolCallId : undefined,
      },
    };
  }
  if (
    subject?.type === 'command' &&
    'command' in subject &&
    'cwd' in subject &&
    typeof subject.command === 'string' &&
    typeof subject.cwd === 'string'
  ) {
    return {
      ...common,
      toolCall: {
        name: 'command',
        kind: 'execute',
        arguments: { command: subject.command, cwd: subject.cwd },
        toolCallId:
          'toolCallId' in subject && typeof subject.toolCallId === 'string'
            ? subject.toolCallId
            : undefined,
      },
    };
  }
  return { ...common, toolCall: { name: request.title, kind: 'other' } };
}
