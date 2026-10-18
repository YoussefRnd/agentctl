import { beforeEach, afterEach, expect, it, vi } from 'vite-plus/test';
import type { SessionEventRow } from '@agentctl/shared';
import { PerformanceRecorder } from './performanceRecorder';

vi.mock('./performanceRecorder', async (original) => {
  const actual = await original<typeof import('./performanceRecorder')>();
  return { ...actual, journeyPerformance: new actual.PerformanceRecorder(true) };
});
import { journeyPerformance } from './performanceRecorder';
import {
  acceptPromptPerformance,
  beginPromptPerformance,
  cancelPromptPerformance,
  observePromptPerformance,
  paintPromptPerformance,
} from './promptPerformance';

let frames: FrameRequestCallback[];
const output = (id: number, parentEventId: number): Extract<SessionEventRow, { type: 'text' }> => ({
  id,
  parentEventId,
  sessionId: 'session',
  type: 'text',
  data: { role: 'provider', content: 'synthetic output' },
  createdAt: new Date(),
});
beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  journeyPerformance.clear();
});
afterEach(() => {
  cancelPromptPerformance('session');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('excludes unrelated output and waits for the matching committed response', () => {
  beginPromptPerformance('session', 'client-id');
  acceptPromptPerformance('session', 10, 'client-id');
  observePromptPerformance('session', [output(2, 1)]);
  paintPromptPerformance('session', 2);
  expect(journeyPerformance.snapshot()).toEqual([]);
  observePromptPerformance('session', [output(11, 10)]);
  expect(journeyPerformance.snapshot().map((sample) => sample.name)).toEqual([
    'send-to-first-text-received',
  ]);
  paintPromptPerformance('session', 11);
  paintPromptPerformance('session', 11);
  frames.shift()!(0);
  frames.shift()!(16);
  expect(journeyPerformance.snapshot()).toHaveLength(3);
});

it('handles SSE and a committed response arriving before the HTTP acknowledgement', () => {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  beginPromptPerformance('session', 'client-id');
  now = 40;
  observePromptPerformance('session', [output(11, 10)]);
  paintPromptPerformance('session', 11);
  now = 60;
  frames.shift()!(0);
  frames.shift()!(16);
  now = 100;
  acceptPromptPerformance('session', 10, 'old-client-id');
  expect(journeyPerformance.snapshot()).toEqual([]);
  acceptPromptPerformance('session', 10, 'client-id');
  expect(journeyPerformance.snapshot().map((sample) => sample.durationMs)).toEqual([40, 60, 20]);
});

it('follows tool parents and cancels incomplete samples on navigation or failure', () => {
  expect(journeyPerformance).toBeInstanceOf(PerformanceRecorder);
  beginPromptPerformance('session', 'client-id');
  acceptPromptPerformance('session', 10, 'client-id');
  observePromptPerformance('session', [
    {
      id: 11,
      parentEventId: 10,
      sessionId: 'session',
      type: 'status',
      data: { status: 'turn_started' },
      createdAt: new Date(),
    },
    output(12, 11),
  ]);
  paintPromptPerformance('session', 12);
  cancelPromptPerformance('session');
  frames.shift()!(0);
  frames.shift()!(16);
  expect(journeyPerformance.snapshot().map((sample) => sample.name)).toEqual([
    'send-to-first-text-received',
  ]);
});

it('excludes child transcripts and recognizes a transient text delta', () => {
  beginPromptPerformance('session', 'client-id');
  acceptPromptPerformance('session', 10, 'client-id');
  observePromptPerformance('session', [
    { ...output(11, 10), metadata: { nativeSessionId: 'child' } },
  ]);
  expect(journeyPerformance.snapshot()).toEqual([]);
  observePromptPerformance('session', [
    { ...output(12, 10), data: { role: 'provider', content: '' }, delta: 'new text' },
  ]);
  expect(journeyPerformance.snapshot().map((sample) => sample.name)).toEqual([
    'send-to-first-text-received',
  ]);
});
