import type { AnyMessage, Stream } from '@agentclientprotocol/sdk';

export class AcpDebugLog {
  private logs: { timestamp: Date; type: 'incoming' | 'outgoing' | 'stderr'; line: string }[] = [];

  recordLine(type: 'incoming' | 'outgoing' | 'stderr', line: string): void {
    this.logs.push({ timestamp: new Date(), type, line });
  }

  getLogs() {
    return this.logs;
  }
}

export type DebugSink = (direction: 'send' | 'recv', message: unknown) => void;

export function wrapDebug(stream: Stream, sink: DebugSink): Stream {
  const { readable, writable } = stream;

  const reader = readable.getReader();
  const loggedReadable = new ReadableStream<AnyMessage>({
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      sink('recv', value);
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  const writer = writable.getWriter();
  const loggedWritable = new WritableStream<AnyMessage>({
    async write(chunk) {
      sink('send', chunk);
      await writer.write(chunk);
    },
    close() {
      return writer.close();
    },
    abort(reason) {
      return writer.abort(reason);
    },
  });

  return { readable: loggedReadable, writable: loggedWritable };
}

export function formatAcpMessageLog(direction: 'send' | 'recv', message: unknown) {
  if (!message || typeof message !== 'object') {
    return { direction };
  }
  const msg = message as Record<string, unknown>;
  const params = (msg.params && typeof msg.params === 'object' ? msg.params : {}) as Record<
    string,
    unknown
  >;
  const update = (
    params.update && typeof params.update === 'object' ? params.update : {}
  ) as Record<string, unknown>;

  return {
    direction,
    method: typeof msg.method === 'string' ? msg.method : undefined,
    id: msg.id,
    sessionId: typeof params.sessionId === 'string' ? params.sessionId : undefined,
    sessionUpdate: typeof update.sessionUpdate === 'string' ? update.sessionUpdate : undefined,
  };
}
