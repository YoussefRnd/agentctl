import { expect, test } from 'vite-plus/test';
import type { SessionEventRow } from '@agentctl/shared';
import { collectAgentTerminals, terminalDetailEvents, boundedTerminalText } from './agentTerminals';

test('terminal snapshots replace output and chunks append without mixing terminals', () => {
  const events = [
    { type: 'terminal_created', data: { terminalId: 'a', command: 'test' } },
    { type: 'terminal_output', data: { terminalId: 'a', data: 'old' } },
    { type: 'terminal_output', data: { terminalId: 'a', data: 'new', operation: 'replace' } },
    { type: 'terminal_output', data: { terminalId: 'a', data: ' chunk' } },
    { type: 'terminal_output', data: { terminalId: 'b', data: 'other' } },
    { type: 'terminal_exit', data: { terminalId: 'a', code: 0 } },
  ] as SessionEventRow[];
  expect(collectAgentTerminals(events)).toEqual([
    { id: 'a', command: 'test', output: 'new chunk', exited: true, code: 0 },
    { id: 'b', command: '', output: 'other', exited: false, code: null },
  ]);
});

test('selects only the output required for the visible tail, including a partial UTF-8 boundary', () => {
  const events: SessionEventRow[] = [1, 2, 3].map((id) => ({
    id,
    sessionId: 's',
    type: 'terminal_output',
    createdAt: new Date(),
    details: { revision: 'a'.repeat(64), outputBytes: 40000 },
    data: { terminalId: 'a', data: '' },
  }));
  expect(terminalDetailEvents(events).map((event) => event.id)).toEqual([2, 3]);
  expect(boundedTerminalText('界'.repeat(30000))).toBe('界'.repeat(Math.floor(65536 / 3)));
});
