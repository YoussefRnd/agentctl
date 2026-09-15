import { memo, useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { MarkdownCodeBlock } from './MarkdownCodeBlock';
import { splitStreamingContent, type StreamingContentSegment } from './streamingMarkdownUtils';

export type { StreamingContentSegment };

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeHighlight];

interface StreamingMarkdownProps {
  content: string;
  isStreaming?: boolean;
}

const graphemeSegmenter =
  typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

export function splitGraphemes(value: string): string[] {
  if (!graphemeSegmenter) return Array.from(value);
  return Array.from(graphemeSegmenter.segment(value), ({ segment }) => segment);
}

export function getAdaptiveRevealRate(observedRate: number, backlog: number): number {
  const providerRate = Number.isFinite(observedRate) ? observedRate : 0;
  return Math.min(600, Math.max(72, providerRate * 1.15 + backlog * 2));
}

export function useSmoothedText(target: string, isStreaming: boolean): string {
  const [displayed, setDisplayed] = useState(target);
  const displayedRef = useRef(target);
  const targetRef = useRef(target);
  const frameRef = useRef<number | null>(null);
  const previousFrameRef = useRef<number | null>(null);
  const observedRateRef = useRef(72);
  const previousTargetRef = useRef({
    length: splitGraphemes(target).length,
    time: performance.now(),
  });
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  );

  const advance = useCallback((frameTime: number) => {
    frameRef.current = null;
    const current = displayedRef.current;
    const latestTarget = targetRef.current;

    if (current === latestTarget) {
      previousFrameRef.current = null;
      return;
    }

    // A replaced or truncated event should never leak text from the previous value.
    if (!latestTarget.startsWith(current)) {
      displayedRef.current = latestTarget;
      setDisplayed(latestTarget);
      previousFrameRef.current = null;
      return;
    }

    const remaining = splitGraphemes(latestTarget.slice(current.length));
    const elapsed = previousFrameRef.current === null ? 16 : frameTime - previousFrameRef.current;
    previousFrameRef.current = frameTime;

    // Match the provider's measured cadence, with extra pressure only while a backlog exists.
    const charactersPerSecond = getAdaptiveRevealRate(observedRateRef.current, remaining.length);
    const step = Math.max(1, Math.floor((charactersPerSecond * Math.max(8, elapsed)) / 1000));
    const next = current + remaining.slice(0, step).join('');

    displayedRef.current = next;
    setDisplayed(next);

    if (next !== latestTarget) {
      frameRef.current = requestAnimationFrame(advance);
    } else {
      previousFrameRef.current = null;
    }
  }, []);

  useEffect(() => {
    targetRef.current = target;
    const targetLength = splitGraphemes(target).length;
    const sampleTime = performance.now();
    const previousTarget = previousTargetRef.current;
    const growth = targetLength - previousTarget.length;
    const elapsed = sampleTime - previousTarget.time;

    if (growth > 0 && elapsed > 8) {
      const sampleRate = (growth * 1000) / elapsed;
      observedRateRef.current = observedRateRef.current * 0.7 + sampleRate * 0.3;
    }
    previousTargetRef.current = { length: targetLength, time: sampleTime };

    if (!isStreaming || prefersReducedMotion) {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      previousFrameRef.current = null;
      displayedRef.current = target;
      setDisplayed(target);
      return;
    }

    if (!target.startsWith(displayedRef.current)) {
      displayedRef.current = target;
      setDisplayed(target);
      return;
    }

    if (displayedRef.current !== target && frameRef.current === null) {
      frameRef.current = requestAnimationFrame(advance);
    }
  }, [advance, isStreaming, prefersReducedMotion, target]);

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
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={{ pre: MarkdownCodeBlock }}>
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
  const [isEnhanced, setIsEnhanced] = useState(() => !isStreaming);

  useEffect(() => {
    if (isStreaming) {
      setIsEnhanced(false);
      return;
    }
    if (isEnhanced) return;

    if (typeof window.requestIdleCallback === 'function') {
      const idleId = window.requestIdleCallback(() => setIsEnhanced(true), { timeout: 500 });
      return () => window.cancelIdleCallback(idleId);
    }

    const timer = window.setTimeout(() => setIsEnhanced(true), 0);
    return () => window.clearTimeout(timer);
  }, [isEnhanced, isStreaming]);

  if (isStreaming || !isEnhanced) {
    return <ProgressiveMarkdownBody content={content} isStreaming={isStreaming} />;
  }
  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={REHYPE_PLUGINS}
      components={{ pre: MarkdownCodeBlock }}
    >
      {content}
    </ReactMarkdown>
  );
});
