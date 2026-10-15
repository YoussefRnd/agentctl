export const ACP_SESSION_CLOSE_TIMEOUT_MS = 2_000;
export const ACP_SESSION_OPERATION_TIMEOUT_MS = 5_000;
export const ACP_MAX_PENDING_UPDATES = 1_024;
export const ACP_MAX_PENDING_UPDATE_BYTES = 16 * 1024 * 1024;
export const ACP_MAX_SUBAGENT_BYTES = 8 * 1024 * 1024;
export const ACP_MAX_SUBAGENTS = 256;
export const ACP_MAX_DIRECTED_MESSAGES = 512;

export function acpPayloadBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8');
}
