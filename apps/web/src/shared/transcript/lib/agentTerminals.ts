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

/** Select only output contributing to the visible 64 KiB tail, after the last replacement. */
export function terminalDetailEvents(events: SessionEventRow[]): SessionEventRow[] {
  const selected = new Set<number>();
  let bytes = 0;
  let replaced = false;
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type !== 'terminal_output') {
      selected.add(event.id);
      continue;
    }
    if (replaced || bytes >= 65536) continue;
    selected.add(event.id);
    bytes += event.details?.outputBytes ?? new TextEncoder().encode(event.data.data).length;
    replaced = event.data.operation === 'replace';
  }
  return events.filter((event) => selected.has(event.id));
}
