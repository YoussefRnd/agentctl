import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  IdleStateUpdate,
  UpdateSessionNotification,
} from '@agentclientprotocol/sdk/experimental/v2';

const errorSchema = z.object({
  code: z.number().int().min(-2147483648).max(2147483647),
  message: z.string(),
  data: z.unknown().optional(),
});

/** SDK 1.7's idle-state decoder predates the v2 `error` field and strips it.
 * Carry it through local metadata, then restore it after SDK validation.
 * The marker is connection-local and is never written to the wire.
 */
export function withV2StateErrors<T>(stream: {
  readable: ReadableStream<T>;
  writable: WritableStream<T>;
}) {
  const marker = `_agentctl_${randomUUID()}`;
  const preserve = (frame: unknown): unknown => {
    if (!frame || typeof frame !== 'object' || Array.isArray(frame)) return frame;
    const message = frame as { method?: string; params?: UpdateSessionNotification };
    const params = message.params;
    const update = params?.update as
      | {
          sessionUpdate?: string;
          state?: string;
          stopReason?: string;
          error?: unknown;
          _meta?: Record<string, unknown> | null;
        }
      | undefined;
    if (
      message.method !== 'session/update' ||
      update?.sessionUpdate !== 'state_update' ||
      update.state !== 'idle' ||
      update.stopReason !== 'error'
    )
      return frame;
    const error = errorSchema.safeParse(update.error);
    if (!error.success) return frame;
    return {
      ...message,
      params: {
        ...params,
        update: {
          ...update,
          _meta: {
            ...update._meta,
            [marker]: {
              error: error.data,
              meta: update._meta,
              hasMeta: Object.hasOwn(update, '_meta'),
            },
          },
        },
      },
    };
  };
  return {
    readable: stream.readable.pipeThrough(
      new TransformStream<T, T>({
        transform(frame, controller) {
          controller.enqueue((Array.isArray(frame) ? frame.map(preserve) : preserve(frame)) as T);
        },
      }),
    ),
    writable: stream.writable,
    restore(notification: UpdateSessionNotification): UpdateSessionNotification {
      if (
        notification.update.sessionUpdate !== 'state_update' ||
        notification.update.state !== 'idle'
      )
        return notification;
      const idle = notification.update as IdleStateUpdate & {
        sessionUpdate: 'state_update';
        state: 'idle';
      };
      const payload = idle._meta?.[marker] as
        | {
            error: z.infer<typeof errorSchema>;
            meta?: Record<string, unknown> | null;
            hasMeta: boolean;
          }
        | undefined;
      if (!payload) return notification;
      const update = { ...idle, error: payload.error, _meta: payload.meta };
      if (!payload.hasMeta) delete update._meta;
      return { ...notification, update };
    },
  };
}
