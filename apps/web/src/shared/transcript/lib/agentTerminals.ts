import type { SessionEventRow } from '@agentctl/shared';

export function boundedTerminalText(value: string): string {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length <= 65536) return value;
  let start = bytes.length - 65536;
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
  return new TextDecoder().decode(bytes.subarray(start));
}

export function collectAgentTerminals(events: SessionEventRow[]) {
  const terminals = new Map<
    string,
    { id: string; command: string; output: string; exited: boolean; code: number | null }
  >();
  for (const event of events) {
    if (
      event.type !== 'terminal_created' &&
      event.type !== 'terminal_output' &&
      event.type !== 'terminal_exit'
    )
      continue;
    const data = event.data;
    let terminal = terminals.get(data.terminalId);
    if (!terminal) {
      terminal = { id: data.terminalId, command: '', output: '', exited: false, code: null };
      terminals.set(data.terminalId, terminal);
    }
    if (event.type === 'terminal_created') {
      terminal.command = event.data.command;
      terminal.exited = false;
    }
    if (event.type === 'terminal_output') {
      terminal.output = boundedTerminalText(
        event.data.operation === 'replace' ? event.data.data : terminal.output + event.data.data,
      );
    }
    if (event.type === 'terminal_exit') {
      terminal.exited = true;
      terminal.code = event.data.code;
    }
  }
  return [...terminals.values()];
}
