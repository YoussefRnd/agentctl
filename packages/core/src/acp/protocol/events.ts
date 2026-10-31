import type {
  SessionConfigOption,
  SessionConfigSelectOptions,
  SessionNotification,
  ToolCall,
} from '@agentclientprotocol/sdk';
import { normalizeReportedCost, type AgentConfigOption } from '@agentctl/shared';
import type { AgentUpdate } from '../../agent/types.js';
import { createCompactionProjector } from './compaction.js';
import { displayAcpContent } from './content.js';
import { modelContextMetadata } from './model-context.js';
import { projectRetryMetadata } from './retry-metadata.js';
import { asRecord, toolArgumentsFrom, toolNameFrom } from './tool-call-utils.js';

function parseCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function blockText(block: unknown): string | undefined {
  const rec = asRecord(block);
  return typeof rec?.text === 'string' ? rec.text : undefined;
}

function parseToolCallEvent(update: ToolCallSnapshot, initial: boolean): AgentUpdate {
  const rawInput = update.rawInput;
  const parsedArgs = toolArgumentsFrom(rawInput);
  return {
    type: 'tool_call',
    call: {
      name:
        initial || update.name || typeof asRecord(rawInput)?.name === 'string'
          ? toolNameFrom(update)
          : undefined,
      arguments: parsedArgs,
      toolCallId: update.toolCallId,
      title: update.title ?? undefined,
      status: update.status ?? undefined,
      kind: update.kind ?? undefined,
      locations: update.locations?.map((location) => ({
        path: location.path,
        line: location.line ?? undefined,
      })),
      content: update.content ?? undefined,
      rawInput: rawInput ?? undefined,
      rawOutput: update.rawOutput ?? undefined,
    },
  };
}

interface ToolCallSnapshot {
  toolCallId: string;
  name?: string | null;
  title?: string | null;
  kind?: ToolCall['kind'] | null;
  status?: ToolCall['status'] | null;
  locations?: ToolCall['locations'] | null;
  content?: ToolCall['content'] | null;
  rawInput?: unknown;
  rawOutput?: unknown;
}

export function projectConfigOption(option: SessionConfigOption): AgentConfigOption {
  return {
    id: option.id,
    name: option.name,
    description: option.description ?? undefined,
    category: option.category ?? undefined,
    type: option.type,
    currentValue: option.currentValue,
    options: option.type === 'select' ? projectSelectOptions(option.options) : undefined,
  };
}

export function projectSelectOptions(
  options: SessionConfigSelectOptions,
): { value: string; name: string; description?: string; contextWindow?: number }[] {
  const projected: { value: string; name: string; description?: string; contextWindow?: number }[] =
    [];
  for (const entry of options) {
    if ('group' in entry) {
      for (const opt of entry.options) {
        projected.push({
          ...modelContextMetadata(opt),
          value: opt.value,
          name: opt.name,
          description: opt.description ?? undefined,
        });
      }
    } else {
      projected.push({
        ...modelContextMetadata(entry),
        value: entry.value,
        name: entry.name,
        description: entry.description ?? undefined,
      });
    }
  }
  return projected;
}

/**
 * Maps a validated ACP `SessionNotification` into our domain event stream.
 * The SDK only accepts the canonical `sessionUpdate` discriminants, so
 * legacy extension keys (status/plan_update/mode_update) never reach us here.
 */
export function parseNotificationToEvents(
  notification: SessionNotification,
  compactions = createCompactionProjector(),
): AgentUpdate[] {
  const update = notification.update;
  const events: AgentUpdate[] = [];

  switch (update.sessionUpdate) {
    case 'notice':
      return [
        {
          type: 'notice',
          severity: update.severity,
          title: update.title,
          description: update.description ?? undefined,
        },
      ];
    case 'compaction_update':
    case 'compaction_summary_chunk':
      return compactions(update);
    case 'user_message_chunk':
    case 'agent_message_chunk': {
      const block = update.content;
      const type = update.sessionUpdate === 'user_message_chunk' ? 'user_text' : 'text';
      if (block.type === 'text') {
        events.push({ type, text: block.text, messageId: update.messageId ?? undefined });
      } else {
        const rec = asRecord(block);
        if (rec?.type === 'thought' || rec?.type === 'thinking') {
          const text = blockText(block);
          if (text)
            events.push({ type: 'thought', text, messageId: update.messageId ?? undefined });
        } else {
          events.push({
            type,
            text: displayAcpContent(block),
            messageId: update.messageId ?? undefined,
          });
        }
      }
      break;
    }
    case 'agent_thought_chunk': {
      const rec = asRecord(update.content);
      const thought =
        blockText(update.content) ?? (typeof rec?.thought === 'string' ? rec.thought : undefined);
      if (thought)
        events.push({ type: 'thought', text: thought, messageId: update.messageId ?? undefined });
      break;
    }
    case 'tool_call':
    case 'tool_call_update':
      events.push(parseToolCallEvent(update, update.sessionUpdate === 'tool_call'));
      break;
    case 'usage_update': {
      const rec = asRecord(update);
      const used = parseCount(rec?.used);
      const size = parseCount(rec?.size);
      if (used !== null && size !== null) {
        events.push({
          type: 'usage_update',
          used: Math.max(0, used),
          size: Math.max(0, size),
          cost: normalizeReportedCost(rec?.cost),
        });
      }
      break;
    }
    case 'available_commands_update': {
      const commands = update.availableCommands.map((cmd) => {
        const inputRec = asRecord(cmd.input);
        return {
          name: cmd.name,
          description: cmd.description,
          input:
            inputRec && typeof inputRec.hint === 'string' ? { hint: inputRec.hint } : undefined,
          category:
            typeof cmd._meta?.command_category === 'string'
              ? cmd._meta.command_category
              : undefined,
        };
      });
      events.push({ type: 'available_commands_update', commands });
      break;
    }
    case 'current_mode_update':
      events.push({ type: 'mode_update', modeId: update.currentModeId });
      break;
    case 'config_option_update':
      events.push({
        type: 'config_option_update',
        configOptions: update.configOptions.map(projectConfigOption),
      });
      break;
    case 'session_info_update':
      events.push({
        type: 'session_info_update',
        title: update.title,
        updatedAt: update.updatedAt,
        ...projectRetryMetadata(update._meta),
      });
      break;
    case 'plan': {
      const plan = update.entries.map((entry) => ({
        name: entry.content,
        status: entry.status,
        isCompleted: entry.status === 'completed',
        priority: entry.priority,
      }));
      events.push({ type: 'plan_update', plan });
      break;
    }
  }

  return events;
}
