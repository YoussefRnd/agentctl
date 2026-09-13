import type {
  AgentMessage,
  AgentThought,
  AvailableCommandsUpdate,
  ConfigOptionUpdate,
  ContentChunk,
  PlanItems,
  PlanUpdate,
  SessionConfigOption,
  SessionInfoUpdate,
  SessionUpdate,
  StateUpdate,
  TerminalOutputChunk,
  TerminalUpdate,
  ToolCallContentChunk,
  ToolCallUpdate,
  UsageUpdate,
} from '@agentclientprotocol/sdk/experimental/v2';
import type { AgentConfigOption } from '@agentctl/shared';
import type { AgentToolCallContent, AgentUpdate } from '../../agent/types.js';

function textFromContent(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (block): block is { type: 'text'; text: string } =>
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: unknown }).type === 'text' &&
        typeof (block as { text?: unknown }).text === 'string',
    )
    .map((block) => block.text)
    .join('');
}

function textChunk(content: unknown): string | null {
  if (typeof content !== 'object' || content === null) return null;
  const block = content as { type?: unknown; text?: unknown };
  return block.type === 'text' && typeof block.text === 'string' ? block.text : null;
}

function projectSelectOptions(option: Extract<SessionConfigOption, { type: 'select' }>) {
  return option.options.flatMap((entry) =>
    'groupId' in entry
      ? entry.options.map((item) => ({
          value: item.value,
          name: item.name,
          description: item.description ?? undefined,
        }))
      : [
          {
            value: entry.value,
            name: entry.name,
            description: entry.description ?? undefined,
          },
        ],
  );
}

export function projectV2ConfigOption(option: SessionConfigOption): AgentConfigOption | null {
  if (option.type !== 'select' && option.type !== 'boolean') return null;
  if (option.type === 'select') {
    const select = option as Extract<SessionConfigOption, { type: 'select' }>;
    return {
      id: select.configId,
      name: select.name,
      description: select.description ?? undefined,
      category: select.category ?? undefined,
      type: 'select',
      currentValue: select.currentValue,
      options: projectSelectOptions(select),
    };
  }
  const bool = option as Extract<SessionConfigOption, { type: 'boolean' }>;
  return {
    id: bool.configId,
    name: bool.name,
    description: bool.description ?? undefined,
    category: bool.category ?? undefined,
    type: 'boolean',
    currentValue: bool.currentValue,
  };
}

/** Converts one ACP v2 update into product-owned updates. */
export function projectV2SessionUpdate(update: SessionUpdate): AgentUpdate[] {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      const value = update as ContentChunk;
      const text = textChunk(value.content);
      return text !== null
        ? [
            {
              type: 'text',
              text,
              messageId: value.messageId,
              operation: 'append',
            },
          ]
        : [];
    }
    case 'agent_message': {
      const value = update as AgentMessage;
      return value.content === undefined
        ? []
        : [
            {
              type: 'text',
              text: textFromContent(value.content),
              messageId: value.messageId,
              operation: 'replace',
            },
          ];
    }
    case 'agent_thought_chunk': {
      const value = update as ContentChunk;
      const text = textChunk(value.content);
      return text !== null
        ? [
            {
              type: 'thought',
              text,
              messageId: value.messageId,
              operation: 'append',
            },
          ]
        : [];
    }
    case 'agent_thought': {
      const value = update as AgentThought;
      return value.content === undefined
        ? []
        : [
            {
              type: 'thought',
              text: textFromContent(value.content),
              messageId: value.messageId,
              operation: 'replace',
            },
          ];
    }
    case 'tool_call_update': {
      const value = update as ToolCallUpdate;
      return [
        {
          type: 'tool_call',
          call: {
            toolCallId: value.toolCallId,
            name: value.name ?? value.title ?? undefined,
            title: value.title ?? undefined,
            status: value.status ?? undefined,
            kind: value.kind ?? undefined,
            locations: value.locations?.map((location) => ({
              path: location.path,
              line: location.line ?? undefined,
            })),
            content: (value.content ?? undefined) as AgentToolCallContent[] | undefined,
            rawInput: value.rawInput,
            rawOutput: value.rawOutput,
          },
          contentOperation: 'replace',
        },
      ];
    }
    case 'tool_call_content_chunk': {
      const value = update as ToolCallContentChunk;
      return [
        {
          type: 'tool_call',
          call: {
            toolCallId: value.toolCallId,
            content: [value.content as AgentToolCallContent],
          },
          contentOperation: 'append',
        },
      ];
    }
    case 'state_update':
      return [{ type: 'status', status: (update as StateUpdate).state }];
    case 'terminal_update': {
      const value = update as TerminalUpdate;
      const events: AgentUpdate[] = [];
      if (typeof value.command === 'string') {
        events.push({
          type: 'terminal_created',
          terminalId: value.terminalId,
          command: value.command,
        });
      }
      if (value.output?.data) {
        events.push({
          type: 'terminal_output',
          terminalId: value.terminalId,
          data: Buffer.from(value.output.data, 'base64').toString('utf8'),
        });
      }
      if (value.exitStatus) {
        events.push({
          type: 'terminal_exit',
          terminalId: value.terminalId,
          code: value.exitStatus.exitCode ?? null,
        });
      }
      return events;
    }
    case 'terminal_output_chunk': {
      const value = update as TerminalOutputChunk;
      return [
        {
          type: 'terminal_output',
          terminalId: value.terminalId,
          data: Buffer.from(value.data, 'base64').toString('utf8'),
        },
      ];
    }
    case 'plan_update': {
      const value = update as PlanUpdate;
      const plan = value.plan as PlanItems;
      return value.plan.type === 'items'
        ? [
            {
              type: 'plan_update',
              plan: plan.entries.map((entry) => ({
                name: entry.content,
                status:
                  entry.status === 'in_progress' || entry.status === 'completed'
                    ? entry.status
                    : 'pending',
                isCompleted: entry.status === 'completed',
                priority:
                  entry.priority === 'high' ||
                  entry.priority === 'medium' ||
                  entry.priority === 'low'
                    ? entry.priority
                    : undefined,
              })),
            },
          ]
        : [];
    }
    case 'available_commands_update': {
      const value = update as AvailableCommandsUpdate;
      return [
        {
          type: 'available_commands_update',
          commands: value.availableCommands.map((command) => ({
            name: command.name,
            description: command.description,
            input:
              command.input?.type === 'text' && typeof command.input.hint === 'string'
                ? { hint: command.input.hint }
                : undefined,
          })),
        },
      ];
    }
    case 'config_option_update': {
      const value = update as ConfigOptionUpdate;
      return [
        {
          type: 'config_option_update',
          configOptions: value.configOptions
            .map(projectV2ConfigOption)
            .filter((option): option is AgentConfigOption => option !== null),
        },
      ];
    }
    case 'session_info_update': {
      const value = update as SessionInfoUpdate;
      return [
        {
          type: 'session_info_update',
          title: value.title,
          updatedAt: value.updatedAt,
        },
      ];
    }
    case 'usage_update': {
      const value = update as UsageUpdate;
      return [
        {
          type: 'usage_update',
          used: Math.max(0, value.used),
          size: Math.max(0, value.size),
          cost: value.cost
            ? { amount: Math.max(0, value.cost.amount), currency: value.cost.currency }
            : undefined,
        },
      ];
    }
    default:
      return [];
  }
}
