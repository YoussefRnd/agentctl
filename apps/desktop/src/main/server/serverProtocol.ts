const readyType = 'ready';
export const shutdownMessage = { type: 'shutdown' } as const;

export function readyMessage(port: number, secret: string) {
  return { type: readyType, port, secret } as const;
}

export function isReadyMessage(message: unknown): message is ReturnType<typeof readyMessage> {
  if (!message || typeof message !== 'object') return false;
  const value = message as Record<string, unknown>;
  return (
    value.type === readyType &&
    Number.isInteger(value.port) &&
    Number(value.port) > 0 &&
    Number(value.port) <= 65535 &&
    typeof value.secret === 'string' &&
    value.secret.length > 0
  );
}

export function isShutdownMessage(message: unknown): boolean {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === shutdownMessage.type
  );
}
