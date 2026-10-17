export interface ReadyMessage {
  type: 'ready';
  port: number;
  secret: string;
}

export function isReadyMessage(message: unknown): message is ReadyMessage {
  if (!message || typeof message !== 'object') return false;
  const value = message as Record<string, unknown>;
  return (
    value.type === 'ready' &&
    Number.isInteger(value.port) &&
    Number(value.port) > 0 &&
    Number(value.port) <= 65535 &&
    typeof value.secret === 'string' &&
    value.secret.length > 0
  );
}
