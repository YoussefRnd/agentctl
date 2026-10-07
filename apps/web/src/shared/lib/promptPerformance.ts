import type { SessionEventRow } from '@agentctl/shared';
import { afterPaint, journeyPerformance } from './performanceRecorder';

interface PendingPrompt {
  clientMessageId: string;
  acceptedId?: number;
  receivedId?: number;
  parents: Map<number, number>;
  candidates: Map<number, number>;
  painted: Map<number, number>;
  cancelPaint: Map<number, () => void>;
}

const pending = new Map<string, PendingPrompt>();

export function beginPromptPerformance(sessionId: string, clientMessageId: string): void {
  if (!journeyPerformance.enabled) return;
  cancelPromptPerformance(sessionId);
  pending.set(sessionId, {
    clientMessageId,
    parents: new Map(),
    candidates: new Map(),
    painted: new Map(),
    cancelPaint: new Map(),
  });
  if (pending.size > 32) cancelPromptPerformance(pending.keys().next().value!);
  journeyPerformance.begin('send-to-first-text-received', sessionId);
  journeyPerformance.begin('send-to-first-text-painted', sessionId);
}

export function acceptPromptPerformance(
  sessionId: string,
  eventId: number,
  clientMessageId: string,
): void {
  const prompt = pending.get(sessionId);
  if (!prompt || prompt.clientMessageId !== clientMessageId) return;
  prompt.acceptedId = eventId;
  resolveFirstText(sessionId, prompt);
}

export function observePromptPerformance(sessionId: string, events: SessionEventRow[]): void {
  const prompt = pending.get(sessionId);
  if (!prompt || prompt.receivedId !== undefined) return;
  for (const event of events) {
    if (
      event.type === 'text' &&
      event.data.role === 'user' &&
      event.data.clientMessageId === prompt.clientMessageId
    )
      prompt.acceptedId = event.id;
    if (event.parentEventId != null) prompt.parents.set(event.id, event.parentEventId);
  }
  if (prompt.parents.size > 2048) {
    cancelPromptPerformance(sessionId);
    return;
  }
  for (const event of events) {
    if (event.type !== 'text' || event.data.role !== 'provider' || event.metadata?.nativeSessionId)
      continue;
    const delta = (event as { delta?: string }).delta;
    if (!event.data.content && !delta) continue;
    if (!prompt.candidates.has(event.id)) prompt.candidates.set(event.id, performance.now());
  }
  if (prompt.candidates.size > 128) {
    cancelPromptPerformance(sessionId);
    return;
  }
  resolveFirstText(sessionId, prompt);
}

function resolveFirstText(sessionId: string, prompt: PendingPrompt): void {
  if (prompt.acceptedId === undefined || prompt.receivedId !== undefined) return;
  for (const [eventId, receivedAt] of prompt.candidates) {
    let ancestor: number | undefined = eventId;
    for (let depth = 0; depth < 64 && ancestor !== undefined; depth++) {
      if (ancestor === prompt.acceptedId) {
        prompt.receivedId = eventId;
        journeyPerformance.finish('send-to-first-text-received', sessionId, receivedAt);
        journeyPerformance.begin('first-text-received-to-painted', sessionId, receivedAt);
        finishIfPainted(sessionId, prompt);
        return;
      }
      ancestor = prompt.parents.get(ancestor);
    }
  }
}

export function paintPromptPerformance(sessionId: string, eventId: number): void {
  const prompt = pending.get(sessionId);
  if (prompt?.acceptedId !== undefined && prompt.receivedId !== eventId) return;
  if (
    !prompt ||
    !prompt.candidates.has(eventId) ||
    prompt.cancelPaint.has(eventId) ||
    prompt.painted.has(eventId)
  )
    return;
  prompt.cancelPaint.set(
    eventId,
    afterPaint(() => {
      if (pending.get(sessionId) !== prompt) return;
      prompt.cancelPaint.delete(eventId);
      prompt.painted.set(eventId, performance.now());
      finishIfPainted(sessionId, prompt);
    }),
  );
}

function finishIfPainted(sessionId: string, prompt: PendingPrompt): void {
  const paintedAt =
    prompt.receivedId !== undefined ? prompt.painted.get(prompt.receivedId) : undefined;
  if (paintedAt === undefined) return;
  journeyPerformance.finish('send-to-first-text-painted', sessionId, paintedAt);
  journeyPerformance.finish('first-text-received-to-painted', sessionId, paintedAt);
  cancelPromptPerformance(sessionId);
}

export function cancelPromptPerformance(sessionId: string): void {
  for (const cancel of pending.get(sessionId)?.cancelPaint.values() ?? []) cancel();
  pending.delete(sessionId);
  journeyPerformance.cancel('send-to-first-text-received', sessionId);
  journeyPerformance.cancel('send-to-first-text-painted', sessionId);
  journeyPerformance.cancel('first-text-received-to-painted', sessionId);
}
