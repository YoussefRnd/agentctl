import { sessionKeys } from '@/shared/lib/queryKeys';
import { Profiler, useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { SessionEventRow } from '@agentctl/shared';
import { EventFeed, StreamingMarkdown } from '@/features/conversation';
import { CommandInputComposer } from '@/features/composer';
import { SessionConfigProvider, SessionStreamProvider } from '@/features/sessions';
import { afterPaint } from '../shared/lib/performanceRecorder';
import { conversationFixture, FIXTURE_VERSION, markdownFixture } from './fixtures';
import { cpuBaselines, createBrowserProbe, summarize } from './measurements';
import {
  SessionStreamProbeFeed,
  STREAM_PROBE_ID,
  installSyntheticStream,
  streamProbeCommits,
} from './sessionStreamProbe';

type Probe = ReturnType<typeof createBrowserProbe>;
interface Workload {
  kind: 'stream' | 'history' | 'live-history';
  content: string;
  streaming: boolean;
  events: SessionEventRow[];
  generation: number;
}
interface Scenario {
  name: string;
  kind: Workload['kind'];
  markdown?: 'plain' | 'code-table';
  size: number;
  tools?: number;
}
const scenarios: Scenario[] = [
  { name: 'short-reply', kind: 'stream', markdown: 'plain', size: 2048 },
  { name: 'long-reply', kind: 'stream', markdown: 'plain', size: 32768 },
  { name: 'long-code-and-tables', kind: 'stream', markdown: 'code-table', size: 32768 },
  { name: 'recent-conversation', kind: 'history', size: 200 },
  { name: 'large-conversation', kind: 'history', size: 1000 },
  { name: 'dense-tool-activity', kind: 'history', size: 1000, tools: 20 },
];
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const painted = () => new Promise<void>((resolve) => afterPaint(resolve));

export function PerformanceLab() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { enabled: false, retry: false, staleTime: Infinity } },
      }),
  );
  const [workload, setWorkload] = useState<Workload>({
    kind: 'stream',
    content: '',
    streaming: false,
    events: [],
    generation: 0,
  });
  const [input, setInput] = useState('');
  const [focused, setFocused] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState(
    'Ready. Run in a foreground tab; results are local and use synthetic content.',
  );
  const [report, setReport] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const commandsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const probeRef = useRef<Probe | null>(null);
  const stopped = useRef(false);
  const generation = useRef(0);
  useEffect(
    () => () => {
      stopped.current = true;
      probeRef.current?.stop();
      client.clear();
    },
    [client],
  );

  const assertActive = () => {
    if (stopped.current || document.visibilityState !== 'visible')
      throw new Error('Run interrupted. Keep the tab visible and rerun the suite.');
  };

  async function waitForCommit(predicate: () => boolean) {
    const deadline = performance.now() + 5000;
    while (!predicate()) {
      assertActive();
      if (performance.now() > deadline)
        throw new Error('Fixture update did not commit within five seconds.');
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    await painted();
  }

  async function runSuite() {
    if (running) return;
    stopped.current = false;
    setRunning(true);
    setReport(null);
    const samples = [];
    try {
      assertActive();
      setStatus('Warming and sampling CPU paths…');
      const cpu = await cpuBaselines();
      for (const scenario of scenarios) {
        // The first repetition warms component and highlighting caches; do not export it.
        for (let repetition = 0; repetition <= 3; repetition++) {
          assertActive();
          setStatus(`${scenario.name}: ${repetition === 0 ? 'warmup' : `sample ${repetition}/3`}`);
          setInput('');
          await painted();
          const probe = createBrowserProbe();
          probeRef.current = probe;
          const content =
            scenario.kind === 'stream' ? markdownFixture(scenario.markdown!, scenario.size) : '';
          const events =
            scenario.kind === 'history' ? conversationFixture(scenario.size, scenario.tools) : [];
          const next: Workload = {
            kind: scenario.kind,
            content,
            events,
            streaming: scenario.kind === 'stream',
            generation: ++generation.current,
          };
          const mountStart = performance.now();
          setWorkload(next);
          await waitForCommit(
            () =>
              document.getElementById('performance-workload')?.dataset.generation ===
              String(next.generation),
          );
          const mountToPaintMs = performance.now() - mountStart;
          probe.setPhase('stream-updates');
          const inputEchoMs: number[] = [];
          const updateCount = scenario.kind === 'stream' ? 40 : 12;
          const streamStart = performance.now();
          let currentContent = content;
          let currentEvents = events;
          let currentInput = '';
          const responseIndex = events.findLastIndex(
            (event) => event.type === 'text' && event.data.role === 'provider',
          );
          for (let update = 0; update < updateCount; update++) {
            await pause(Math.max(0, streamStart + (update + 1) * 50 - performance.now()));
            assertActive();
            if (scenario.kind === 'stream') {
              currentContent += ' next';
              setWorkload({ ...next, content: currentContent });
            } else {
              const previous = currentEvents[responseIndex];
              currentEvents = currentEvents.map((event, index) =>
                index === responseIndex && previous.type === 'text'
                  ? {
                      ...previous,
                      data: { ...previous.data, content: previous.data.content + ' next' },
                    }
                  : event,
              );
              setWorkload({ ...next, events: currentEvents });
            }
            if (update % 4 === 0) {
              const start = performance.now();
              currentInput += 'x';
              setInput(currentInput);
              await waitForCommit(() => textareaRef.current?.value === currentInput);
              inputEchoMs.push(performance.now() - start);
              if (textareaRef.current?.value !== currentInput)
                throw new Error('Composer fixture lost an input update.');
            }
          }
          const completionStart = performance.now();
          probe.setPhase('completion-and-highlighting');
          setWorkload({
            ...next,
            content: currentContent,
            events: currentEvents,
            streaming: false,
          });
          // Include deferred enhancement/highlighting after stream completion.
          await pause(650);
          if (scenario.kind === 'stream') {
            await waitForCommit(
              () =>
                document.querySelector('#performance-workload [data-markdown-state="complete"]') !==
                null,
            );
            if (document.querySelector('#performance-workload .animate-pulse-block'))
              throw new Error('Completed reply retained its streaming caret.');
            if (
              scenario.markdown === 'code-table' &&
              !document.querySelector('#performance-workload .hljs-keyword')
            )
              throw new Error('Completed code reply was not highlighted.');
            if (
              scenario.markdown === 'code-table' &&
              !document.querySelector('#performance-workload [data-markdown-source="worker"]')
            )
              throw new Error(
                'Markdown worker did not complete; the fallback invalidates this comparison.',
              );
          }
          await painted();
          const completed = probe.stop();
          probeRef.current = null;
          if (Object.keys(completed.commits).length === 0)
            throw new Error('React profiling is unavailable. Use the performance build.');
          if (repetition > 0)
            samples.push({
              scenario: scenario.name,
              repetition,
              inputSize: scenario.kind === 'stream' ? content.length : events.length,
              updateCount,
              mountToPaintMs,
              completionWindowMs: performance.now() - completionStart,
              finalMarkdownSource:
                document.querySelector<HTMLElement>('#performance-workload [data-markdown-source]')
                  ?.dataset.markdownSource ?? null,
              syntheticInputEchoMs: summarize(inputEchoMs),
              ...completed,
            });
        }
      }
      assertActive();
      setReport(
        JSON.stringify(
          {
            schemaVersion: 1,
            fixtureVersion: FIXTURE_VERSION,
            generatedAt: new Date().toISOString(),
            environment: {
              mode: import.meta.env.MODE,
              reactProfiling: true,
              userAgent: navigator.userAgent,
              hardwareConcurrency: navigator.hardwareConcurrency,
              viewport: { width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio },
              reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
              visibility: document.visibilityState,
            },
            methodology: {
              repetitions: 3,
              warmupPerScenario: 1,
              chunkIntervalMs: 50,
              postCompletionWaitMs: 650,
              paint: 'two requestAnimationFrame callbacks',
              typing: 'synthetic controlled-input updates; excludes keyboard dispatch',
              scope:
                'isolated UI components; excludes server, provider, route fetching, and Electron process startup',
            },
            cpu,
            scenarios: samples,
          },
          null,
          2,
        ),
      );
      setStatus('Suite complete. Export the JSON for before/after comparison.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      probeRef.current?.stop();
      probeRef.current = null;
      setRunning(false);
    }
  }

  async function runStreamProbe() {
    if (running) return;
    stopped.current = false;
    setRunning(true);
    setReport(null);
    const samples = [];
    try {
      for (let repetition = 0; repetition <= 3; repetition++) {
        setStatus(`session-stream: ${repetition ? `sample ${repetition}/3` : 'warmup'}`);
        const events = conversationFixture(1000).map((event) => ({
          ...event,
          sessionId: STREAM_PROBE_ID,
        }));
        client.setQueryData(sessionKeys.events(STREAM_PROBE_ID), events);
        client.setQueryData(sessionKeys.detail(STREAM_PROBE_ID), {
          session: { id: STREAM_PROBE_ID, status: 'idle' },
          capabilities: [],
        });
        client.setQueryData(sessionKeys.execution(STREAM_PROBE_ID), { queue: [] });
        const transport = installSyntheticStream();
        const probe = createBrowserProbe();
        probeRef.current = probe;
        try {
          setWorkload({
            kind: 'live-history',
            events: [],
            content: '',
            streaming: false,
            generation: ++generation.current,
          });
          await waitForCommit(
            () =>
              transport.ready() &&
              document.getElementById('performance-workload')?.dataset.generation ===
                String(generation.current),
          );
          probe.setPhase('stream-updates');
          const before = { ...streamProbeCommits };
          const response = events.findLast(
            (event) => event.type === 'text' && event.data.role === 'provider',
          )!;
          let content = String(response.data.content);
          for (let update = 0; update < 16; update++) {
            assertActive();
            const delta = ` probe-${update}`;
            content += delta;
            transport.send({
              ...response,
              delta,
              data: { ...response.data, content: '' },
            } as SessionEventRow);
            await waitForCommit(
              () =>
                client
                  .getQueryData<SessionEventRow[]>(sessionKeys.events(STREAM_PROBE_ID))
                  ?.find((event) => event.id === response.id)?.data.content === content,
            );
            await pause(20);
          }
          probe.setPhase('completion-and-highlighting');
          // A final row supersedes deltas and removes the stream indicator.
          transport.send({ ...response, data: { ...response.data, content } } as SessionEventRow);
          transport.send({
            ...events.at(-1)!,
            id: 1001,
            data: { status: 'turn_end' },
          } as SessionEventRow);
          await pause(50);
          await painted();
          const result = probe.stop();
          if (!document.getElementById('performance-workload')?.textContent?.includes('probe-15'))
            throw new Error('SSE fixture output did not reach the feed.');
          if (repetition)
            samples.push({
              scenario: 'session-stream',
              repetition,
              updateCount: 16,
              subscribers: {
                queue: streamProbeCommits.queue - before.queue,
                turn: streamProbeCommits.turn - before.turn,
                prompts: streamProbeCommits.prompts - before.prompts,
              },
              ...result,
            });
        } finally {
          setWorkload({
            kind: 'history',
            events: [],
            content: '',
            streaming: false,
            generation: ++generation.current,
          });
          await painted();
          transport.restore();
          probe.stop();
          probeRef.current = null;
        }
      }
      setReport(
        JSON.stringify(
          {
            schemaVersion: 1,
            fixtureVersion: FIXTURE_VERSION,
            generatedAt: new Date().toISOString(),
            environment: { mode: import.meta.env.MODE, userAgent: navigator.userAgent },
            methodology: {
              scope:
                'real SessionEngine parser, 16ms batching, cache, SessionStreamProvider and EventFeed; synthetic in-memory SSE transport; excludes server/provider/network',
            },
            cpu: [],
            scenarios: samples,
          },
          null,
          2,
        ),
      );
      setStatus('Suite complete. Export the JSON for before/after comparison.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  }

  function download() {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([report], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'agentctl-performance.json';
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="bg-background text-text-main flex h-screen flex-col gap-3 overflow-hidden p-4">
      <header className="shrink-0 space-y-2">
        <h1 className="text-xl font-semibold">AgentCtl performance lab</h1>
        <p className="text-text-muted text-sm">
          Real conversation and composer components. Synthetic data. No server or agent required.
        </p>
        <div className="flex gap-3">
          <button
            className="rounded border px-3 py-1"
            disabled={running}
            onClick={() => void runSuite()}
          >
            Run baseline suite
          </button>
          <button
            className="rounded border px-3 py-1"
            disabled={!running}
            onClick={() => {
              stopped.current = true;
            }}
          >
            Stop
          </button>
          <button className="rounded border px-3 py-1" disabled={!report} onClick={download}>
            Export JSON
          </button>
          <button
            className="rounded border px-3 py-1"
            disabled={running}
            onClick={() => void runStreamProbe()}
          >
            Run stream probe
          </button>
        </div>
        <p role="status" className="text-text-muted text-sm">
          {status}
        </p>
      </header>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <SessionConfigProvider sessionId="">
            <SessionStreamProvider
              key={workload.kind === 'live-history' ? workload.generation : 'isolated'}
              sessionId={workload.kind === 'live-history' ? STREAM_PROBE_ID : ''}
            >
              <div
                id="performance-workload"
                data-generation={workload.generation}
                className="flex min-h-0 flex-1 flex-col gap-3"
              >
                <Profiler
                  id="conversation"
                  onRender={(id, phase, duration) =>
                    probeRef.current?.onRender(id, phase, duration)
                  }
                >
                  <div className="min-h-0 flex-1 overflow-y-auto rounded border">
                    {workload.kind === 'stream' ? (
                      <div key={workload.generation} className="prose prose-invert max-w-none p-4">
                        <StreamingMarkdown
                          content={workload.content}
                          isStreaming={workload.streaming}
                        />
                      </div>
                    ) : workload.kind === 'live-history' ? (
                      <SessionStreamProbeFeed />
                    ) : (
                      <EventFeed key={workload.generation} events={workload.events} />
                    )}
                  </div>
                </Profiler>
                <Profiler
                  id="composer"
                  onRender={(id, phase, duration) =>
                    probeRef.current?.onRender(id, phase, duration)
                  }
                >
                  <CommandInputComposer
                    input={input}
                    handleInputChange={setInput}
                    setIsFocused={setFocused}
                    flags={{ isFocused: focused }}
                    handleSubmit={() => undefined}
                    handlePaste={() => undefined}
                    handleDrop={(event) => event.preventDefault()}
                    handleAttachClick={() => undefined}
                    textareaRef={textareaRef}
                    filteredCommands={[]}
                    activeCommandIndex={0}
                    setActiveCommandIndex={() => undefined}
                    commandRefs={commandsRef}
                    handleSelectCommand={() => undefined}
                    attachments={[]}
                    removeAttachment={() => undefined}
                    retryAttachment={() => undefined}
                  />
                </Profiler>
              </div>
            </SessionStreamProvider>
          </SessionConfigProvider>
        </MemoryRouter>
      </QueryClientProvider>
      {report && (
        <details className="max-h-48 shrink-0 overflow-auto">
          <summary>Raw measurements</summary>
          <pre id="performance-report" className="text-xs">
            {report}
          </pre>
        </details>
      )}
    </main>
  );
}
