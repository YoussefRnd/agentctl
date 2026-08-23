import { memo } from 'react';
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

function StreamingBody({ content }: { content: string }) {
  const segments = splitStreamingContent(content);
  return (
    <>
      {segments.map((segment) =>
        segment.type === 'code' ? (
          <MarkdownCodeBlock key={segment.key}>{segment.value}</MarkdownCodeBlock>
        ) : (
          <span key={segment.key} className="whitespace-pre-wrap">
            {segment.value}
          </span>
        ),
      )}
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
