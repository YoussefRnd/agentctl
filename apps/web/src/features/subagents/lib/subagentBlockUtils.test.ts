import { describe, expect, it } from 'vitest';
import type { SessionEventRow, SessionEventToolCallData } from '@agentctl/shared';
import {
  extractSubagentGroups,
  extractToolArguments,
  getSubagentGroupKey,
  getSubagentScopeFromData,
  getSubagentTitleFromData,
  isSubagentToolCall,
  subagentApprovals,
  subagentDisplayStatus,
  subagentResult,
  toolResultText,
} from './subagentBlockUtils';

function row(
  id: number,
  type: string,
  data: unknown,
  parentEventId?: number,
  sessionId = 'session-a',
): SessionEventRow {
  return {
    id,
    type,
    data,
    parentEventId,
    sessionId,
    createdAt: new Date(1700000000000 + id * 1000),
  } as SessionEventRow;
}
const task = (id: number, toolCallId: string, status = 'in_progress') =>
  row(id, 'tool_call', {
    name: 'task',
    toolCallId,
    title: `Task ${toolCallId}`,
    status,
    arguments: { prompt: `Do ${toolCallId}` },
  });

describe('provider-independent delegated task presentation', () => {
  it('recognizes ACP delegation display titles when the provider reports a generic other kind', () => {
    const events = [
      row(1, 'tool_call', {
        name: 'other',
        kind: 'other',
        title: 'Run invoke_subagent?',
        toolCallId: 'approval-call',
        status: 'failed',
        arguments: {
          Subagents: [
            { Role: 'Code inspector', Prompt: 'Inspect files' },
            { Role: 'Docs inspector', Prompt: 'Inspect docs' },
          ],
        },
        rawOutput: 'Tool call was approved but never executed.',
      }),
      row(2, 'tool_call', {
        name: 'other',
        kind: 'other',
        title: 'Running start_subagent',
        toolCallId: 'actual-call',
        status: 'completed',
        rawOutput: 'Launch 4 test subagents',
      }),
      row(3, 'tool_call', { name: 'read', toolCallId: 'child-read', status: 'completed' }),
    ];
    const groups = extractSubagentGroups(events);
    expect(groups).toHaveLength(2);
    expect(groups[0].subagentEvent.data).toMatchObject({
      name: 'Delegate 2 tasks',
      scope: '1. Code inspector: Inspect files\n\n2. Docs inspector: Inspect docs',
      status: 'failed',
    });
    expect(groups[1].subagentEvent.data).toMatchObject({
      name: 'Running start subagent',
      status: 'completed',
    });
    expect(subagentResult(groups[1])).toBe('Launch 4 test subagents');
    // Flattened tools have no reported child identity and must stay in the parent feed.
    expect(groups.every((group) => group.childEvents.length === 0)).toBe(true);
    expect(extractSubagentGroups(JSON.parse(JSON.stringify(events)))).toHaveLength(2);
  });

  it.each(['start_subagent', 'invoke_subagents', 'spawn_agents'])(
    'recognizes the %s delegation operation',
    (name) => {
      expect(isSubagentToolCall({ name })).toBe(true);
    },
  );
  it('does not infer completion from parent text, another tool, or a turn ending', () => {
    const groups = extractSubagentGroups([
      task(1, 'a'),
      task(2, 'b'),
      row(3, 'text', { role: 'provider', content: 'I am doing other work' }),
      row(4, 'tool_call', { name: 'read_file', toolCallId: 'read', status: 'completed' }),
      row(5, 'status', { status: 'turn_end', stopReason: 'end_turn' }),
    ]);
    expect(groups.map((group) => subagentDisplayStatus(group))).toEqual(['Running', 'Running']);
    expect(groups.every((group) => group.childEvents.length === 0)).toBe(true);
  });

  it('merges partial snapshots by session and opaque tool id without moving cards', () => {
    const events = [
      task(1, 'a'),
      task(2, 'b'),
      row(3, 'tool_call', { toolCallId: 'a', status: 'completed', rawOutput: 'Finished A' }),
    ];
    const [a, b] = extractSubagentGroups(events);
    expect(a.subagentEvent.data).toMatchObject({
      name: 'Task a',
      scope: 'Do a',
      status: 'completed',
    });
    expect(a.childEvents).toEqual([]);
    expect(subagentResult(a)).toBe('Finished A');
    expect(subagentDisplayStatus(b)).toBe('Running');
    expect(getSubagentGroupKey(a)).toBe(getSubagentGroupKey(extractSubagentGroups([events[0]])[0]));
    // A JSON round trip models a reload from persisted history.
    expect(extractSubagentGroups(JSON.parse(JSON.stringify(events))).map(subagentResult)).toEqual([
      'Finished A',
      '',
    ]);
  });

  it('does not conflate the same tool id in different sessions', () => {
    const first = task(1, 'same');
    const second = { ...task(2, 'same'), sessionId: 'session-b' };
    const groups = extractSubagentGroups([first, second]);
    expect(groups).toHaveLength(2);
    expect(getSubagentGroupKey(groups[0])).not.toBe(getSubagentGroupKey(groups[1]));
  });

  it('upserts reported subagent lifecycle events and follows explicit nested parent links', () => {
    const groups = extractSubagentGroups([
      row(1, 'subagent_update', {
        subagentId: 'a',
        name: 'Review',
        scope: 'Review files',
        status: 'running',
      }),
      row(2, 'text', { role: 'thought', content: 'Inspecting' }, 1),
      row(3, 'tool_call', { name: 'read', toolCallId: 'read-1', status: 'completed' }, 2),
      row(4, 'text', { role: 'provider', content: 'Found a bug' }, 1),
      row(5, 'subagent_update', {
        subagentId: 'a',
        name: 'Review',
        scope: 'Review files',
        status: 'completed',
        result: { summary: 'Found a bug' },
      }),
      row(6, 'text', { role: 'provider', content: 'Parent response' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].childEvents.map((event) => event.id)).toEqual([2, 3, 4]);
    expect(subagentResult(groups[0])).toBe('Found a bug');
  });

  it('associates permissions only through reported tool identity or ancestry', () => {
    const [group] = extractSubagentGroups([
      task(1, 'a'),
      row(2, 'tool_call', { toolCallId: 'child-edit', name: 'edit' }, 1),
      row(3, 'approval_request', { toolCallId: 'child-edit', status: 'pending' }),
      row(4, 'approval_request', { toolCallId: 'unrelated', status: 'pending' }),
    ]);
    expect(subagentApprovals(group).map((event) => event.id)).toEqual([3]);
    expect(subagentDisplayStatus(group)).toBe('Needs approval');
    const [denied] = extractSubagentGroups([
      task(1, 'a'),
      row(3, 'approval_request', { toolCallId: 'a', status: 'denied' }),
    ]);
    expect(subagentApprovals(denied)).toHaveLength(0);
  });

  it.each(['unknown', 'cancelled', 'interrupted', 'failed'])(
    'preserves %s and freezes elapsed time at its final update',
    (status) => {
      const event = task(1, 'a', status);
      event.metadata = { durationMs: 12000 };
      const [group] = extractSubagentGroups([event]);
      expect(group.subagentEvent.data).toMatchObject({ status });
      expect(new Date(group.endedAt!).getTime() - new Date(group.startedAt!).getTime()).toBe(12000);
    },
  );

  it('shows disconnected and unknown states without inventing a result', () => {
    const [group] = extractSubagentGroups([task(1, 'a')]);
    expect(subagentDisplayStatus(group, false)).toBe('Disconnected');
    expect(subagentResult(group)).toBe('');
    const [unknown] = extractSubagentGroups([task(1, 'a', 'future_state')]);
    expect(subagentDisplayStatus(unknown)).toBe('Status unknown');
  });

  it('renders content or arbitrary JSON results without string coercion or duplication', () => {
    const [group] = extractSubagentGroups([
      row(1, 'tool_call', {
        name: 'task',
        toolCallId: 'a',
        status: 'completed',
        rawOutput: [1, 'two'],
      }),
    ]);
    expect(subagentResult(group)).toBe('[\n  1,\n  "two"\n]');
    const [text] = extractSubagentGroups([
      row(1, 'tool_call', {
        name: 'task',
        toolCallId: 'a',
        status: 'completed',
        rawOutput: 'fallback',
        content: [{ type: 'content', content: { type: 'text', text: 'Reported result' } }],
      }),
    ]);
    expect(subagentResult(text)).toBe('Reported result');
  });

  it('does not present polling tools or text mentioning subagents as delegated runs', () => {
    expect(isSubagentToolCall({ name: 'get_subagent_output' })).toBe(false);
    expect(isSubagentToolCall({ name: 'list_subagents' })).toBe(false);
    expect(isSubagentToolCall({ name: 'tool', title: 'Waiting for subagents' })).toBe(false);
    expect(isSubagentToolCall({ name: 'other', title: 'Running get_subagent_output' })).toBe(false);
    expect(isSubagentToolCall({ name: 'other', title: 'Run list_subagents?' })).toBe(false);
    expect(
      isSubagentToolCall({ name: 'other', title: 'Read a file mentioning invoke_subagent' }),
    ).toBe(false);
    expect(isSubagentToolCall({ name: 'tool', arguments: { subagent_type: 'reviewer' } })).toBe(
      false,
    );
  });

  it('recognizes namespaced and provider-specific delegation operations', () => {
    expect(isSubagentToolCall({ name: 'delegate' })).toBe(true);
    expect(isSubagentToolCall({ name: 'delegate_task' })).toBe(true);
    expect(isSubagentToolCall({ name: 'delegate_to_agent' })).toBe(true);
    expect(isSubagentToolCall({ name: 'spawn_subagent' })).toBe(true);
    expect(isSubagentToolCall({ name: 'run_subagent' })).toBe(true);
    expect(isSubagentToolCall({ name: 'dispatch_agent' })).toBe(true);
    expect(isSubagentToolCall({ name: 'fork_agent' })).toBe(true);
    expect(isSubagentToolCall({ name: 'mcp__task' })).toBe(true);
    expect(isSubagentToolCall({ name: 'builtin__invoke_subagent' })).toBe(true);
    expect(isSubagentToolCall({ name: 'agent:delegate' })).toBe(true);
  });

  it('extracts arguments and recognizes subagents from stringified JSON payloads', () => {
    const stringifiedArgs = {
      name: 'task',
      arguments: '{"prompt": "Inspect codebase", "subagent_type": "Auditor"}' as unknown as Record<
        string,
        unknown
      >,
    };
    expect(isSubagentToolCall(stringifiedArgs)).toBe(true);
    expect(extractToolArguments(stringifiedArgs)).toEqual({
      prompt: 'Inspect codebase',
      subagent_type: 'Auditor',
    });

    const stringifiedRawInput = {
      name: 'tool',
      rawInput: '{"name": "task", "arguments": {"prompt": "Run tests", "agent": "tester"}}',
    };
    expect(isSubagentToolCall(stringifiedRawInput)).toBe(true);
    expect(extractToolArguments(stringifiedRawInput)).toEqual({
      prompt: 'Run tests',
      agent: 'tester',
    });
  });

  it('supports diverse agent provider parameter formats (Antigravity, Codex, Swarm)', () => {
    // Antigravity single subagent format
    const antigravityCall = {
      name: 'invoke_subagent',
      arguments: {
        Subagents: [
          { TypeName: 'research', Role: 'Codebase Researcher', Prompt: 'Find auth handlers' },
        ],
      },
    };
    expect(isSubagentToolCall(antigravityCall)).toBe(true);
    expect(getSubagentTitleFromData(antigravityCall)).toBe('Codebase Researcher');
    expect(getSubagentScopeFromData(antigravityCall)).toBe(
      'Codebase Researcher: Find auth handlers',
    );

    // Codex / Swarm style instruction & agent
    const codexCall = {
      name: 'agent_call',
      arguments: {
        agent: 'security_auditor',
        instruction: 'Check for SSRF vulnerabilities',
      },
    };
    expect(isSubagentToolCall(codexCall)).toBe(true);
    expect(getSubagentTitleFromData(codexCall)).toBe('Security auditor');
    expect(getSubagentScopeFromData(codexCall)).toBe('Check for SSRF vulnerabilities');

    // Planner with goal
    const plannerCall = {
      name: 'subagent',
      arguments: {
        subagent: 'architect',
        goal: 'Design database schema',
      },
    };
    expect(isSubagentToolCall(plannerCall)).toBe(true);
    expect(getSubagentScopeFromData(plannerCall)).toBe('Design database schema');
  });

  it('extracts ACP v2 text blocks and unwraps result envelopes from raw output', () => {
    const acpV2Call = {
      name: 'task',
      toolCallId: 'call-v2',
      content: [{ type: 'text', text: 'ACP v2 streaming result' }],
    } as unknown as SessionEventToolCallData;
    expect(toolResultText(acpV2Call)).toBe('ACP v2 streaming result');

    const envelopeCall = {
      name: 'task',
      toolCallId: 'call-env',
      rawOutput: { result: 'Subagent finished work' },
    };
    expect(toolResultText(envelopeCall)).toBe('Subagent finished work');

    const outputCall = {
      name: 'task',
      toolCallId: 'call-out',
      rawOutput: { output: 'All tests passed' },
    };
    expect(toolResultText(outputCall)).toBe('All tests passed');
  });
});
