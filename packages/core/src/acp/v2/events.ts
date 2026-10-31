import type {
  AgentMessage,
  AgentThought,
  AvailableCommandsUpdate,
  CompactionSummaryChunk,
  CompactionUpdate,
  ConfigOptionUpdate,
  ContentChunk,
  PlanItems,
  PlanRemoved,
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
  UserMessage,
} from '@agentclientprotocol/sdk/experimental/v2';
import { normalizeReportedCost, type AgentConfigOption } from '@agentctl/shared';
import type { AgentToolCallContent, AgentUpdate } from '../../agent/types.js';
import { createCompactionProjector } from '../protocol/compaction.js';
import { displayAcpContent } from '../protocol/content.js';
import { modelContextMetadata } from '../protocol/model-context.js';
import { projectRetryMetadata } from '../protocol/retry-metadata.js';
import { toolArgumentsFrom } from '../protocol/tool-call-utils.js';
import { createTerminalProjector } from './terminals.js';

function textFromContent(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content.map(displayAcpContent).join('');
}

function projectSelectOptions(option: Extract<SessionConfigOption, { type: 'select' }>) {
  return option.options.flatMap((entry) =>
    'groupId' in entry
      ? entry.options.map((item) => ({
          ...modelContextMetadata(item),
          value: item.value,
          name: item.name,
          description: item.description ?? undefined,
        }))
      : [
          {
            ...modelContextMetadata(entry),
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
export function projectV2SessionUpdate(
  update: SessionUpdate,
  projectTerminal = createTerminalProjector(),
): AgentUpdate[] {
  switch (update.sessionUpdate) {
    case 'notice': {
      const notice = update as { severity: string; title: string; description?: string | null };
      return [
        {
          type: 'notice',
          severity: notice.severity,
          title: notice.title,
          description: notice.description ?? undefined,
        },
      ];
    }
    case 'user_message_chunk':
    case 'agent_message_chunk': {
      const value = update as ContentChunk;
      const text = displayAcpContent(value.content);
      return [
        {
          type: update.sessionUpdate === 'user_message_chunk' ? 'user_text' : 'text',
          text,
          messageId: value.messageId,
          operation: 'append',
        },
      ];
    }
    case 'user_message':
    case 'agent_message': {
      const value = update as AgentMessage | UserMessage;
      return value.content === undefined
        ? []
        : [
            {
              type: update.sessionUpdate === 'user_message' ? 'user_text' : 'text',
              text: textFromContent(value.content),
              messageId: value.messageId,
              operation: 'replace',
            },
          ];
    }
    case 'agent_thought_chunk': {
      const value = update as ContentChunk;
      const text = displayAcpContent(value.content);
      return [
        {
          type: 'thought',
          text,
          messageId: value.messageId,
          operation: 'append',
        },
      ];
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
            name: value.name ?? undefined,
            arguments: toolArgumentsFrom(value.rawInput),
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
          clearFields: [
            'name',
            'title',
            'status',
            'kind',
            'locations',
            'content',
            'rawInput',
            'rawOutput',
          ]
            .filter((field) => (value as unknown as Record<string, unknown>)[field] === null)
            .flatMap((field) =>
              field === 'rawInput'
                ? ['rawInput', 'arguments']
                : field === 'locations' || field === 'kind' || field === 'content'
                  ? [field, 'effects']
                  : [field],
            ),
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
    case 'terminal_update':
    case 'terminal_output_chunk':
      return projectTerminal({
        ...(update as TerminalUpdate | TerminalOutputChunk),
        sessionUpdate: update.sessionUpdate,
      });
    case 'plan_update': {
      const value = update as PlanUpdate;
      const plan = value.plan as PlanItems;
      if (value.plan.type === 'items') {
        const items: Extract<AgentUpdate, { type: 'plan_update' }>['plan'] = plan.entries.map(
          (entry) => ({
            name: entry.content,
            status: entry.status,
            isCompleted: entry.status === 'completed',
            priority: entry.priority,
          }),
        );
        return [
          { type: 'plan_update', plan: items, artifact: { id: plan.planId, kind: 'items', items } },
        ];
      }
      const other = value.plan as { planId?: string; type: string; content?: string; uri?: string };
      return [
        {
          type: 'plan_update',
          plan: [],
          artifact: {
            id: other.planId ?? 'agent-plan',
            kind: other.type === 'markdown' || other.type === 'file' ? other.type : 'unknown',
            ...(other.type === 'markdown'
              ? { markdown: (other.content ?? '').slice(0, 65536) }
              : {}),
            ...(other.type === 'file' ? { uri: (other.uri ?? '').slice(0, 4096) } : {}),
            ...(other.type !== 'file' && other.type !== 'markdown'
              ? { contentType: other.type.slice(0, 128) }
              : {}),
          },
        },
      ];
    }
    case 'plan_removed':
      return [{ type: 'plan_update', plan: [], removedPlanId: (update as PlanRemoved).planId }];
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
          ...projectRetryMetadata(value._meta),
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
          cost: normalizeReportedCost(value.cost),
        },
      ];
    }
    default:
      return [];
  }
}

export function createV2SessionProjector() {
  const projectTerminal = createTerminalProjector();
  const compactions = createCompactionProjector();
  return (update: SessionUpdate) => {
    if (
      update.sessionUpdate === 'compaction_update' ||
      update.sessionUpdate === 'compaction_summary_chunk'
    )
      return compactions(
        update as
          | (CompactionUpdate & { sessionUpdate: 'compaction_update' })
          | (CompactionSummaryChunk & { sessionUpdate: 'compaction_summary_chunk' }),
      );
    return projectV2SessionUpdate(update, projectTerminal);
  };
}
