import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { openEventStream } from './event-stream.js';
import type { ClientSetup, ClientResult } from './client-protocol.js';

// This process owns HTTP, response decoding and SSE parsing, and imports no application runtime.
const parentDisconnected = () => process.exit(1);
process.once('disconnect', parentDisconnected);
const watchdog = setTimeout(() => process.exit(1), 60_000);
const [setup] = (await once(process, 'message')) as [ClientSetup];
assert.equal(setup.type, 'setup');
const { url, ids } = setup;
const streams = await Promise.all(
  ids.map((id) => openEventStream(`${url}/api/sessions/${id}/events/stream`)),
);

async function until(check: () => boolean) {
  const deadline = performance.now() + 30_000;
  while (!check()) {
    assert(performance.now() < deadline, 'Client workload timed out');
    await delay(5);
  }
}

async function send(id: string, text: string) {
  const response = await fetch(`${url}/api/sessions/${id}/input`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input: text, clientMessageId: randomUUID() }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json()) as { eventId: number };
  assert.equal(response.status, 200, JSON.stringify(body));
  assert(Number.isInteger(body.eventId));
  return body.eventId;
}

async function history(id: string) {
  const response = await fetch(`${url}/api/sessions/${id}/events/page?limit=200`, {
    signal: AbortSignal.timeout(15_000),
  });
  const page = (await response.json()) as { events: unknown[]; nextBeforeId: number | null };
  assert.equal(response.status, 200);
  assert(page.events.length > 0 && page.events.length <= 201);
  assert(page.nextBeforeId !== null, 'Large history must retain a usable cursor');
}

const ended = (stream: (typeof streams)[number]) =>
  stream.events.filter((event) => (event.data.data as { status?: string }).status === 'turn_end');

async function measure() {
  for (const stream of streams) stream.events.length = 0;
  const acceptMs: number[] = [];
  const historyMs: number[] = [];
  const receipts: number[] = [];
  const started = new Map<string, number>();
  await Promise.all(
    ids.map(async (id) => {
      for (let turn = 0; turn < 5; turn++) {
        const text = `synthetic turn ${turn}`;
        const start = performance.now();
        started.set(`${id}:${text}`, start);
        receipts.push(await send(id, text));
        acceptMs.push(performance.now() - start);
        const pageStart = performance.now();
        await history(id);
        historyMs.push(performance.now() - pageStart);
      }
    }),
  );
  await until(() => streams.every((stream) => ended(stream).length === 5));
  const firstOutputMs: number[] = [];
  const completionMs: number[] = [];
  for (const [index, stream] of streams.entries()) {
    const prompts = new Map<number, string>();
    const text = new Map<number, string>();
    for (const event of stream.events) {
      const payload = event.data.data as { role?: string; content?: string; status?: string };
      if (payload.role === 'user') prompts.set(event.id, payload.content!);
      const start = started.get(`${ids[index]}:${prompts.get(event.data.parentEventId as number)}`);
      if (payload.status === 'turn_end') completionMs.push(event.receivedAt - start!);
      if (payload.role !== 'provider') continue;
      if (!text.has(event.id)) firstOutputMs.push(event.receivedAt - start!);
      text.set(
        event.id,
        event.data.delta === undefined
          ? payload.content!
          : (text.get(event.id) ?? '') + String(event.data.delta),
      );
    }
    assert.equal(text.size, 5);
    for (const content of text.values()) assert.equal(content, 'synthetic output '.repeat(20));
  }
  const turns = ids.length * 5;
  for (const values of [acceptMs, historyMs, firstOutputMs, completionMs]) {
    assert.equal(values.length, turns);
    assert(values.every((value) => Number.isFinite(value) && value >= 0));
  }
  assert.equal(new Set(receipts).size, turns);
  const summarize = (values: number[]) => {
    values = [...values].sort((a, b) => a - b);
    return {
      count: values.length,
      p50: values[Math.ceil(values.length * 0.5) - 1],
      p95: values[Math.ceil(values.length * 0.95) - 1],
      max: values.at(-1)!,
    };
  };
  return {
    type: 'done' as const,
    acceptMs: summarize(acceptMs),
    historyMs: summarize(historyMs),
    firstOutputMs: summarize(firstOutputMs),
    completionMs: summarize(completionMs),
    receipts,
  } satisfies ClientResult;
}

try {
  await Promise.all(
    ids.map(async (id) => {
      await send(id, 'discarded warmup turn');
      await history(id);
    }),
  );
  await until(() => streams.every((stream) => ended(stream).length === 1));
  let command = once(process, 'message');
  process.send!({ type: 'ready' });
  while (true) {
    const [message] = await command;
    const type = (message as { type: string }).type;
    if (type === 'close') break;
    assert.equal(type, 'start');
    watchdog.refresh();
    const result = await measure();
    command = once(process, 'message');
    process.send!(result);
  }
} finally {
  clearTimeout(watchdog);
  for (const stream of streams) stream.close();
}
process.off('disconnect', parentDisconnected);
process.disconnect!();
