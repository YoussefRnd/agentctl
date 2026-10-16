import { memo, startTransition, useCallback, useEffect, useRef, useState } from 'react';
import type { Root } from 'hast';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { MarkdownCodeBlock } from './MarkdownCodeBlock';
import { MarkdownTable } from './MarkdownTable';
import { splitStreamingContent, type StreamingContentSegment } from './streamingMarkdownUtils';
import { GraphemeRevealBuffer } from '../lib/graphemeRevealBuffer';
import { subscribeMarkdown } from '../lib/markdownWorker';
import { PreparedMarkdown } from './PreparedMarkdown';

export { splitGraphemes } from '../lib/graphemeRevealBuffer';

export type { StreamingContentSegment };

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeHighlight];
const MARKDOWN_COMPONENTS = { pre: MarkdownCodeBlock, table: MarkdownTable };
const WORKER_THRESHOLD = 8192;

interface StreamingMarkdownProps {
  content: string;
  isStreaming?: boolean;
}

export function getAdaptiveRevealRate(observedRate: number, backlog: number): number {
  const providerRate = Number.isFinite(observedRate) ? observedRate : 0;
  return Math.min(600, Math.max(72, providerRate * 1.15 + backlog * 2));
}

export function useSmoothedText(target: string, isStreaming: boolean): string {
  const [displayed, setDisplayed] = useState(target);
  const [buffer] = useState(() => new GraphemeRevealBuffer(target));
  const frameRef = useRef<number | null>(null);
  const previousFrameRef = useRef<number | null>(null);
  const observedRateRef = useRef(72);
  const previousSampleTimeRef = useRef(performance.now());
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  );

  const advance = useCallback(
    (frameTime: number) => {
      frameRef.current = null;
      if (buffer.backlog === 0) {
        previousFrameRef.current = null;
        return;
      }

      const elapsed = previousFrameRef.current === null ? 16 : frameTime - previousFrameRef.current;
      previousFrameRef.current = frameTime;

      // Match the provider's measured cadence, with extra pressure only while a backlog exists.
      const charactersPerSecond = getAdaptiveRevealRate(observedRateRef.current, buffer.backlog);
      const step = Math.max(1, Math.floor((charactersPerSecond * Math.max(8, elapsed)) / 1000));
      setDisplayed(buffer.reveal(step));

      if (buffer.backlog > 0) {
        frameRef.current = requestAnimationFrame(advance);
      } else {
        previousFrameRef.current = null;
      }
    },
    [buffer],
  );

  useEffect(() => {
    const { growth, replaced } = buffer.update(target);
    const sampleTime = performance.now();
    const elapsed = sampleTime - previousSampleTimeRef.current;

    if (growth > 0 && elapsed > 8) {
      const sampleRate = (growth * 1000) / elapsed;
      observedRateRef.current = observedRateRef.current * 0.7 + sampleRate * 0.3;
    }
    previousSampleTimeRef.current = sampleTime;

    if (!isStreaming || prefersReducedMotion) {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      previousFrameRef.current = null;
      setDisplayed(buffer.finish());
      return;
    }

    if (replaced) previousFrameRef.current = null;
    // Extending the last already-visible grapheme is immediate and atomic.
    setDisplayed(buffer.displayed);

    if (buffer.backlog > 0 && frameRef.current === null) {
      frameRef.current = requestAnimationFrame(advance);
    }
  }, [advance, buffer, isStreaming, prefersReducedMotion, target]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => setPrefersReducedMotion(query.matches);
    query.addEventListener('change', updatePreference);
    return () => query.removeEventListener('change', updatePreference);
  }, []);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  return isStreaming ? displayed : target;
}

function StreamingCaret() {
  return (
    <span
      className="animate-pulse-block bg-accent/60 ml-0.5 inline-block h-[1em] w-px rounded-full align-middle"
      aria-hidden="true"
    />
  );
}

const StaticBlock = memo(
  function StaticBlock({ segment }: { segment: StreamingContentSegment }) {
    if (segment.type === 'code') {
      return <MarkdownCodeBlock>{segment.value}</MarkdownCodeBlock>;
    }
    return (
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>
        {segment.value}
      </ReactMarkdown>
    );
  },
  (prev, next) =>
    prev.segment.key === next.segment.key && prev.segment.value === next.segment.value,
);

function ActiveTailBlock({ segment }: { segment: StreamingContentSegment }) {
  return (
    <>
      {segment.type === 'code' ? (
        <MarkdownCodeBlock>{segment.value}</MarkdownCodeBlock>
      ) : (
        <span className="whitespace-pre-wrap">{segment.value}</span>
      )}
      <StreamingCaret />
    </>
  );
}

function ProgressiveMarkdownBody({
  content,
  isStreaming,
}: {
  content: string;
  isStreaming: boolean;
}) {
  const smoothedContent = useSmoothedText(content, isStreaming);
  const segments = splitStreamingContent(smoothedContent);

  if (segments.length === 0) {
    return isStreaming ? <StreamingCaret /> : null;
  }

  const stableSegments = isStreaming ? segments.slice(0, -1) : segments;
  const tailSegment = isStreaming ? segments[segments.length - 1] : null;

  return (
    <>
      {stableSegments.map((segment) => (
        <StaticBlock key={segment.key} segment={segment} />
      ))}
      {tailSegment && <ActiveTailBlock key={tailSegment.key} segment={tailSegment} />}
    </>
  );
}

export const StreamingMarkdown = memo(function StreamingMarkdown({
  content,
  isStreaming = false,
}: StreamingMarkdownProps) {
  const [prepared, setPrepared] = useState<{ content: string; tree: Root | null } | null>(null);
  // The measured benefit is in code-heavy enhancement. Plain-text completion
  // avoids worker startup and structured-clone overhead.
  const useWorker =
    content.length >= WORKER_THRESHOLD &&
    (content.includes('```') || content.includes('~~~')) &&
    typeof Worker !== 'undefined';

  useEffect(() => {
    if (isStreaming || !useWorker) return;
    let cancelled = false;
    const unsubscribe = subscribeMarkdown(content, (tree) => {
      if (!cancelled) startTransition(() => setPrepared({ content, tree }));
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [content, isStreaming, useWorker]);

  const resolved = prepared?.content === content ? prepared : null;
  const pending = !isStreaming && useWorker && !resolved;
  let body;
  if (isStreaming || pending) {
    // Keep the same progressive component mounted during worker preparation.
    body = <ProgressiveMarkdownBody content={content} isStreaming={isStreaming} />;
  } else if (resolved?.tree) {
    body = <PreparedMarkdown tree={resolved.tree} components={MARKDOWN_COMPONENTS} />;
  } else {
    body = (
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={MARKDOWN_COMPONENTS}
      >
        {content}
      </ReactMarkdown>
    );
  }
  return (
    <div
      className="[&>:first-child]:mt-0 [&>:last-child]:mb-0"
      data-markdown-state={isStreaming ? 'streaming' : pending ? 'preparing' : 'complete'}
      data-markdown-source={
        isStreaming || pending ? 'progressive' : resolved?.tree ? 'worker' : 'synchronous'
      }
    >
      {body}
    </div>
  );
});
