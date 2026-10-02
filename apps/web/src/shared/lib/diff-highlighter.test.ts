import { expect, it, vi } from 'vitest';

it('deduplicates worker jobs, drops off-screen work, caches results and degrades safely on failure', async () => {
  vi.resetModules();
  const workers: FakeWorker[] = [];
  class FakeWorker {
    onmessage?: (event: { data: { key: string; html: string }[] }) => void;
    onerror?: () => void;
    postMessage = vi.fn();
    terminate = vi.fn();
    constructor() {
      workers.push(this);
    }
  }
  vi.stubGlobal('Worker', FakeWorker);
  try {
    const { subscribeDiffHighlight, getDiffHighlight } = await import('./diff-highlighter');
    const first = vi.fn();
    const second = vi.fn();
    const cancel = subscribeDiffHighlight('const x = 1;', 'typescript', first);
    subscribeDiffHighlight('const x = 1;', 'typescript', second);
    cancel();
    for (let i = 0; i < 100; i++) {
      subscribeDiffHighlight(`offscreen${i}`, 'typescript', vi.fn())();
    }
    expect(getDiffHighlight('<script>&', 'typescript')).toBe('&lt;script&gt;&amp;');
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    const worker = workers[0];
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    const jobs = worker.postMessage.mock.calls[0][0];
    expect(jobs).toHaveLength(1);
    worker.onmessage?.({ data: [{ key: jobs[0].key, html: '<span>colored</span>' }] });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledExactlyOnceWith('<span>colored</span>');
    const remount = vi.fn();
    subscribeDiffHighlight('const x = 1;', 'typescript', remount);
    expect(remount).toHaveBeenCalledExactlyOnceWith('<span>colored</span>');
    expect(getDiffHighlight('const x = 1;', 'typescript')).toBe('<span>colored</span>');
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    const failed = vi.fn();
    subscribeDiffHighlight('const newer = 2;', 'typescript', failed);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    worker.onerror?.();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(getDiffHighlight('<unsafe>', 'typescript')).toBe('&lt;unsafe&gt;');
    subscribeDiffHighlight('after failure', 'typescript', failed);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    expect(failed).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
