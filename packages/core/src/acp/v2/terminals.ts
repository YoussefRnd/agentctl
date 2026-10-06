import { StringDecoder } from 'node:string_decoder';
import type { AgentUpdate } from '../../agent/types.js';

export const MAX_TERMINAL_FRAME_BYTES = 64 * 1024;
export const MAX_TERMINAL_OUTPUT_BYTES = 64 * 1024;

export function terminalFrame(encoded: string): Buffer | undefined {
  if (
    encoded.length > Math.ceil(MAX_TERMINAL_FRAME_BYTES / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}(?:==)?|[A-Za-z0-9+/]{3}=?|)?$/.test(encoded)
  )
    return;
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > MAX_TERMINAL_FRAME_BYTES) return;
  return bytes;
}

export function boundedTerminalOutput(value: string): string {
  const bytes = Buffer.from(value);
  if (bytes.length <= MAX_TERMINAL_OUTPUT_BYTES) return value;
  let start = bytes.length - MAX_TERMINAL_OUTPUT_BYTES;
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
  return bytes.subarray(start).toString();
}

/** Decoders are scoped to one ACP session, so split codepoints cannot cross terminals. */
export function createTerminalProjector() {
  const decoders = new Map<string, StringDecoder>();
  return (update: {
    sessionUpdate: string;
    terminalId: string;
    data?: string;
    command?: string | null;
    output?: { data: string } | null;
    exitStatus?: { exitCode?: number | null } | null;
  }): AgentUpdate[] => {
    const events: AgentUpdate[] = [];
    let decoder = decoders.get(update.terminalId);
    if (!decoder) {
      if (decoders.size >= 128) return [];
      decoder = new StringDecoder('utf8');
      decoders.set(update.terminalId, decoder);
    }
    if (update.sessionUpdate === 'terminal_output_chunk') {
      const bytes = terminalFrame(update.data ?? '');
      if (bytes) {
        const data = decoder.write(bytes);
        if (data)
          events.push({
            type: 'terminal_output',
            terminalId: update.terminalId,
            data,
            operation: 'append',
          });
      }
      return events;
    }
    if (update.command !== undefined)
      events.push({
        type: 'terminal_created',
        terminalId: update.terminalId,
        command: update.command ?? '',
      });
    if (update.output !== undefined) {
      const bytes = update.output === null ? Buffer.alloc(0) : terminalFrame(update.output.data);
      if (bytes) {
        decoder = new StringDecoder('utf8');
        decoders.set(update.terminalId, decoder);
        events.push({
          type: 'terminal_output',
          terminalId: update.terminalId,
          data: boundedTerminalOutput(decoder.write(bytes)),
          operation: 'replace',
        });
      }
    }
    if (update.exitStatus) {
      const final = decoder.end();
      if (final)
        events.push({
          type: 'terminal_output',
          terminalId: update.terminalId,
          data: final,
          operation: 'append',
        });
      decoders.delete(update.terminalId);
      events.push({
        type: 'terminal_exit',
        terminalId: update.terminalId,
        code: update.exitStatus.exitCode ?? null,
      });
    }
    return events;
  };
}
