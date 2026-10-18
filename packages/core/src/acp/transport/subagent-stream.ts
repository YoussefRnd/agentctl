interface Packet {
  method?: string;
  id?: string | number;
  params?: unknown;
  result?: unknown;
}
function packet(value: unknown): Packet | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Packet)
    : undefined;
}
/** Track replay boundaries and reject batch dependencies before SDK validation and routing. */
export function withSessionSetupTracking<T>(
  stream: { readable: ReadableStream<T>; writable: WritableStream<T> },
  options: {
    onRootSession?: (id: string) => void;
    onError: (error: unknown) => void;
  },
) {
  const setups = new Map<string | number, { sessionId?: string; replay: boolean }>();
  const replaying = new Set<string>();
  const accepted = new Set<string>();

  const observeOutgoing = (value: unknown) => {
    const msg = packet(value);
    if (!msg || msg.id === undefined) return;
    if (
      !['session/new', 'session/fork', 'session/load', 'session/resume'].includes(msg.method ?? '')
    )
      return;
    const params = packet(msg.params) as { sessionId?: string; replayFrom?: unknown } | undefined;
    const replay =
      msg.method === 'session/load' || (msg.method === 'session/resume' && !!params?.replayFrom);
    const sessionId = ['session/load', 'session/resume'].includes(msg.method ?? '')
      ? params?.sessionId
      : undefined;
    setups.set(msg.id, { sessionId, replay });
    if (sessionId && replay) replaying.add(sessionId);
  };
  const reader = stream.readable.getReader();
  const writer = stream.writable.getWriter();
  return {
    isHistorical: (id: string) => replaying.has(id),
    canBuffer: (id: string) =>
      accepted.has(id) ||
      [...setups.values()].some((setup) => !setup.sessionId || setup.sessionId === id),
    finishSetup: (id: string) => accepted.delete(id),
    release: (id: string) => {
      accepted.delete(id);
      replaying.delete(id);
    },
    readable: new ReadableStream<T>({
      async pull(controller) {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            controller.close();
            return;
          }
          const frames = Array.isArray(value) ? value : [value];
          const forwarded: unknown[] = [];
          // Announcements in a batch cannot establish dependencies in that same batch.
          const announcements = new Set(
            frames.flatMap((frame) => {
              const msg = packet(frame);
              const params = packet(msg?.params) as
                | { update?: { sessionUpdate?: string; sessionId?: string } }
                | undefined;
              return params?.update?.sessionUpdate === 'subagent_update' && params.update.sessionId
                ? [params.update.sessionId]
                : [];
            }),
          );
          for (const frame of frames) {
            const msg = packet(frame);
            const setup = msg?.id !== undefined && !msg.method ? setups.get(msg.id) : undefined;
            if (setup) {
              setups.delete(msg!.id!);
              if (setup.sessionId) replaying.delete(setup.sessionId);

              const result = packet(msg?.result) as { sessionId?: unknown } | undefined;
              const id = typeof result?.sessionId === 'string' ? result.sessionId : setup.sessionId;
              if (msg?.result !== undefined && id) accepted.add(id);
              if (typeof result?.sessionId === 'string') options.onRootSession?.(result.sessionId);
            }
            const params = packet(msg?.params) as
              | {
                  sessionId?: string;
                  update?: {
                    sessionUpdate?: string;
                    senderSessionId?: string;
                    recipientSessionId?: string;
                  };
                }
              | undefined;
            if (
              Array.isArray(value) &&
              params &&
              [
                params.sessionId,
                params.update?.senderSessionId,
                params.update?.recipientSessionId,
              ].some((id) => id && announcements.has(id))
            ) {
              options.onError(
                new Error('ACP child announcement and dependent traffic share a batch'),
              );
              continue;
            }
            forwarded.push(frame);
          }
          if (!forwarded.length) continue;
          controller.enqueue((Array.isArray(value) ? forwarded : forwarded[0]) as T);
          return;
        }
      },
      cancel: (reason) => reader.cancel(reason),
    }),
    writable: new WritableStream<T>({
      async write(value) {
        for (const frame of Array.isArray(value) ? value : [value]) observeOutgoing(frame);
        await writer.write(value);
      },
      close: () => writer.close(),
      abort: (reason) => writer.abort(reason),
    }),
  };
}
