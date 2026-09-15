import { describe, expect, it } from 'vitest';
import type { SessionEventRow } from '@agentctl/shared';
import { getAgentStreamPhase } from './agentStreamPhase';

const event = (
  id: number,
  type: SessionEventRow['type'],
  data: SessionEventRow['data'],
): SessionEventRow =>
  ({
    id,
    sessionId: '00000000-0000-0000-0000-000000000000',
    type,
    data,
    createdAt: new Date('2026-09-15T00:00:00.000Z'),
  }) as SessionEventRow;

describe('getAgentStreamPhase', () => {
  it('tracks thought to tool to response transitions', () => {
    const thought = event(1, 'text', { role: 'thought', content: 'Inspecting' });
    const tool = event(2, 'tool_call', { name: 'read_file' });
    const response = event(3, 'text', { role: 'provider', content: 'Done' });

    expect(getAgentStreamPhase([thought])).toBe('thinking');
    expect(getAgentStreamPhase([thought, tool])).toBe('tool');
    expect(getAgentStreamPhase([thought, tool, response])).toBe('responding');
  });

  it('returns to thinking if a provider emits more reasoning after partial response text', () => {
    expect(
      getAgentStreamPhase([
        event(1, 'text', { role: 'provider', content: 'First' }),
        event(2, 'text', { role: 'thought', content: 'Checking again' }),
      ]),
    ).toBe('thinking');
  });
});
