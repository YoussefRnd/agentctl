import { memo, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { MarkdownCodeBlock } from './MarkdownCodeBlock';
import { splitStreamingContent, type StreamingContentSegment } from './streamingMarkdownUtils';

export type { StreamingContentSegment };

const REHYPE_PLUGINS = [remarkGfm, rehypeHighlight];

interface StreamingMarkdownProps {
  content: string;
  isStreaming?: boolean;
}

export function useSmoothedText(target: string, isStreaming: boolean): string {
  const [displayed, setDisplayed] = useState(target);

  useEffect(() => {
    if (!isStreaming) return;
    if (displayed.length >= target.length) return;

    let rafId: number | null = null;

    const tick = () => {
      setDisplayed((current) => {
        if (current.length >= target.length) return current;
        const gap = target.length - current.length;
        const step = Math.max(2, Math.ceil(gap / 8));
        const next = target.slice(0, current.length + step);
        if (next.length < target.length) {
          rafId = requestAnimationFrame(tick);
        }
        return next;
      });
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [target, isStreaming, displayed.length]);

  return isStreaming ? displayed : target;
}

const StaticBlock = memo(
  function StaticBlock({ segment }: { segment: StreamingContentSegment }) {
    if (segment.type === 'code') {
      return <MarkdownCodeBlock>{segment.value}</MarkdownCodeBlock>;
    }
    return <span className="whitespace-pre-wrap">{segment.value}</span>;
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
      <span
        className="bg-accent/70 ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-xs align-middle"
        aria-hidden="true"
      />
    </>
  );
}

function StreamingBody({ content }: { content: string }) {
  const smoothedContent = useSmoothedText(content, true);
  const segments = splitStreamingContent(smoothedContent);

  if (segments.length === 0) {
    return (
      <span
        className="bg-accent/70 ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-xs align-middle"
        aria-hidden="true"
      />
    );
  }

  const frozenSegments = segments.slice(0, -1);
  const tailSegment = segments[segments.length - 1];

  return (
    <>
      {frozenSegments.map((segment) => (
        <StaticBlock key={segment.key} segment={segment} />
      ))}
      <ActiveTailBlock key={tailSegment.key} segment={tailSegment} />
    </>
  );
}

export const StreamingMarkdown = memo(function StreamingMarkdown({
  content,
  isStreaming = false,
}: StreamingMarkdownProps) {
  if (isStreaming) {
    return <StreamingBody content={content} />;
  }
  return (
    <ReactMarkdown rehypePlugins={REHYPE_PLUGINS} components={{ pre: MarkdownCodeBlock }}>
      {content}
    </ReactMarkdown>
  );
});
