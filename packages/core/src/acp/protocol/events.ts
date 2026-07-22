import type { SessionNotification } from '@agentclientprotocol/sdk';
import type { DomainAgentEvent, ToolCallContent } from '../types.js';
import type { ACPConfigOption } from '@agentctl/shared';

export function parseNotificationToEvents(notification: SessionNotification): DomainAgentEvent[] {
  const update = notification.update;
  const typeKey = update.sessionUpdate;
  const events: DomainAgentEvent[] = [];
  const _meta = (update as Record<string, unknown>)._meta as Record<string, unknown> | undefined;

  if (typeKey === 'agent_message_chunk') {
    const chunk = update as Record<string, unknown>;
    const content = chunk.content as Record<string, unknown> | undefined;
    const text = content?.text;
    if (typeof text === 'string') {
      const isThought = content?.type === 'thought' || content?.type === 'thinking';
      if (isThought) {
        events.push({ type: 'thought', text, _meta });
      } else {
        events.push({ type: 'text', text, _meta });
      }
    }
  } else if (typeKey === 'agent_thought_chunk') {
    const chunk = update as Record<string, unknown>;
    const content = chunk.content as Record<string, unknown> | undefined;
    const thought = (content?.text ?? content?.thought) as string | undefined;
    if (typeof thought === 'string') {
      events.push({ type: 'thought', text: thought, _meta });
    }
  } else if (typeKey === 'tool_call' || typeKey === 'tool_call_update') {
    const chunk = update as {
      name?: string;
      arguments?: Record<string, unknown>;
      toolCallId?: string;
      title?: string;
      status?: string;
      rawInput?: unknown;
      locations?: { path?: string }[];
      kind?: string;
      content?: ToolCallContent[];
      rawOutput?: Record<string, unknown>;
    };
    const rawInput = chunk.rawInput as Record<string, unknown> | undefined;

    let parsedName = chunk.name ?? '';
    if (!parsedName && chunk.toolCallId) {
      parsedName = chunk.toolCallId.split('__')[0];
    }
    if (!parsedName) {
      parsedName = chunk.kind ?? 'tool';
    }

    let parsedArgs = chunk.arguments;
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
        if (!parsedName && typeof rawInput.name === 'string') {
          parsedName = rawInput.name;
        }
      }
    }

    if (!parsedArgs) {
      const primaryPath = chunk.locations?.[0]?.path ?? chunk.title;
      if (primaryPath) {
        parsedArgs = {
          path: primaryPath,
          TargetFile: primaryPath,
          AbsolutePath: primaryPath,
        };
      } else {
        parsedArgs = {};
      }
    }

    events.push({
      type: 'tool_call',
      call: {
        name: parsedName,
        arguments: parsedArgs,
        toolCallId: chunk.toolCallId,
        title: chunk.title,
        status: chunk.status,
        kind: chunk.kind,
        locations: chunk.locations,
        content: chunk.content,
        rawInput: rawInput,
        rawOutput: chunk.rawOutput,
      },
      isUpdate: typeKey === 'tool_call_update',
      _meta,
    });
  } else if ((typeKey as string) === 'status') {
    const chunk = update as unknown as { status: string; title?: string };
    if (chunk.status) {
      events.push({ type: 'status', status: chunk.status, title: chunk.title, _meta });
    }
  } else if (typeKey === 'usage_update') {
    const chunk = update as unknown as {
      used: number | string;
      size: number | string;
      cost?: {
        amount: number | string;
        currency: string;
      };
    };
    const used = typeof chunk.used === 'number' ? chunk.used : parseInt(chunk.used, 10);
    const size = typeof chunk.size === 'number' ? chunk.size : parseInt(chunk.size, 10);
    let cost: { amount: number; currency: string } | undefined = undefined;
    if (chunk.cost) {
      const amt =
        typeof chunk.cost.amount === 'number' ? chunk.cost.amount : parseFloat(chunk.cost.amount);
      if (!isNaN(amt)) {
        cost = {
          amount: amt,
          currency: chunk.cost.currency,
        };
      }
    }
    if (!isNaN(used) && !isNaN(size)) {
      events.push({
        type: 'usage_update',
        used,
        size,
        cost,
        _meta,
      });
    }
  } else if (typeKey === 'available_commands_update') {
    const chunk = update as unknown as {
      availableCommands?: {
        name: string;
        description: string;
        input?: {
          hint: string;
        };
        _meta?: {
          command_category?: string;
        };
      }[];
    };
    if (chunk.availableCommands && Array.isArray(chunk.availableCommands)) {
      events.push({
        type: 'available_commands_update',
        commands: chunk.availableCommands.map((cmd) => ({
          name: cmd.name,
          description: cmd.description,
          input: cmd.input ? { hint: cmd.input.hint } : undefined,
          category: cmd._meta?.command_category,
        })),
        _meta,
      });
    }
  } else if ((typeKey as string) === 'plan') {
    const chunk = update as { entries?: { content: string; priority?: string; status: string }[] };
    if (Array.isArray(chunk.entries)) {
      events.push({
        type: 'plan_update',
        plan: chunk.entries.map((entry) => ({
          name: entry.content,
          status: entry.status as 'pending' | 'in_progress' | 'completed',
          isCompleted: entry.status === 'completed',
          priority: entry.priority as 'high' | 'medium' | 'low' | undefined,
        })),
        _meta,
      });
    }
  } else if ((typeKey as string) === 'plan_update') {
    const chunk = update as unknown as {
      plan: {
        name: string;
        status: 'pending' | 'in_progress' | 'completed';
        isCompleted: boolean;
        priority?: 'high' | 'medium' | 'low';
      }[];
    };
    if (Array.isArray(chunk.plan)) {
      events.push({
        type: 'plan_update',
        plan: chunk.plan.map((item) => ({
          name: item.name,
          status: item.status,
          isCompleted: item.isCompleted,
          priority: item.priority,
        })),
        _meta,
      });
    }
  } else if ((typeKey as string) === 'mode_update') {
    const chunk = update as unknown as { modeId: string };
    if (chunk.modeId) {
      events.push({ type: 'mode_update', modeId: chunk.modeId, _meta });
    }
  } else if ((typeKey as string) === 'session_info_update') {
    const chunk = update as Record<string, unknown>;
    events.push({
      type: 'session_info_update',
      title: typeof chunk.title === 'string' || chunk.title === null ? chunk.title : undefined,
      updatedAt:
        typeof chunk.updatedAt === 'string' || chunk.updatedAt === null
          ? chunk.updatedAt
          : undefined,
      _meta,
    });
  } else if ((typeKey as string) === 'user_message_chunk') {
    const chunk = update as { content?: { type?: string; text?: string } };
    const text = chunk.content?.text;
    if (text) {
      events.push({ type: 'text', text, _meta });
    }
  } else if ((typeKey as string) === 'config_option_update') {
    const chunk = update as { configOptions?: ACPConfigOption[] };
    if (chunk.configOptions && chunk.configOptions.length > 0) {
      events.push({ type: 'config_option_update', configOptions: chunk.configOptions, _meta });
    }
  }

  return events;
}
