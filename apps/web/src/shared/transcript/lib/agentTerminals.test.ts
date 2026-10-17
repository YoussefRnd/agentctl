import { expect, test } from 'vitest';
import type { SessionEventRow } from '@agentctl/shared';
import { collectAgentTerminals } from './agentTerminals';

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
