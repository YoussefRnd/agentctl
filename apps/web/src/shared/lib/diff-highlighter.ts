import { escapeHtml, MAX_SYNTAX_LINE_LENGTH } from './code-highlighter-utils';

const CACHE_BYTES = 1024 * 1024;
const BATCH_SIZE = 64;
const cache = new Map<string, string>();
let cacheBytes = 0;
let worker: Worker | undefined;
let failed = false;
let busy = false;
let scheduled = false;

type Job = { code: string; language: string; listeners: Set<(html: string) => void> };
const pending = new Map<string, Job>();
const queued = new Set<string>();

export interface HighlightRequest {
  key: string;
  code: string;
  language: string;
}
export interface HighlightResult {
  key: string;
  html: string;
}

function keyFor(code: string, language?: string) {
  return `${language ?? ''}\0${code}`;
}

export function getDiffHighlight(code: string, language?: string): string {
  const key = keyFor(code, language);
  const html = cache.get(key);
  if (html !== undefined) {
    cache.delete(key);
    cache.set(key, html);
    return html;
  }
  return code ? escapeHtml(code) : '&nbsp;';
}

function remember(key: string, html: string) {
  const bytes = (key.length + html.length) * 2;
  if (bytes > CACHE_BYTES) return;
  while (cacheBytes + bytes > CACHE_BYTES) {
    const oldest = cache.entries().next().value!;
    cacheBytes -= (oldest[0].length + oldest[1].length) * 2;
    cache.delete(oldest[0]);
  }
  cache.set(key, html);
  cacheBytes += bytes;
}

function disableWorker() {
  failed = true;
  worker?.terminate();
  worker = undefined;
  busy = false;
  queued.clear();
  pending.clear();
  // Mounted lines already show escaped text. Never fall back to synchronous
  // grammar work when a worker cannot start or crashes.
}

function schedule() {
  if (scheduled || busy || failed) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    if (busy || !queued.size || failed) return;
    try {
      worker ??= new Worker(new URL('./diff-highlighter.worker.ts', import.meta.url), {
        type: 'module',
      });
      worker.onerror = disableWorker;
      worker.onmessageerror = disableWorker;
      worker.onmessage = (event: MessageEvent<HighlightResult[]>) => {
        busy = false;
        for (const { key, html } of event.data) {
          remember(key, html);
          const job = pending.get(key);
          pending.delete(key);
          job?.listeners.forEach((listener) => listener(html));
        }
        schedule();
      };
      const batch: HighlightRequest[] = [];
      for (const key of queued) {
        queued.delete(key);
        const job = pending.get(key);
        if (!job?.listeners.size) {
          pending.delete(key);
          continue;
        }
        batch.push({ key, code: job.code, language: job.language });
        if (batch.length === BATCH_SIZE) break;
      }
      if (batch.length) {
        busy = true;
        worker.postMessage(batch);
      }
    } catch {
      disableWorker();
    }
  });
}

export function subscribeDiffHighlight(
  code: string,
  language: string | undefined,
  listener: (html: string) => void,
): () => void {
  if (
    !code ||
    !language ||
    code.length > MAX_SYNTAX_LINE_LENGTH ||
    failed ||
    typeof Worker === 'undefined'
  )
    return () => {};
  const key = keyFor(code, language);
  const cached = cache.get(key);
  if (cached !== undefined) {
    listener(cached);
    return () => {};
  }
  let job = pending.get(key);
  if (!job) {
    job = { code, language, listeners: new Set() };
    pending.set(key, job);
    queued.add(key);
  }
  job.listeners.add(listener);
  schedule();
  return () => {
    job.listeners.delete(listener);
    if (!job.listeners.size) {
      if (pending.get(key) === job && queued.delete(key)) pending.delete(key);
    }
  };
}
