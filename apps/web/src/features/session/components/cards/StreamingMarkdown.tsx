import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { MarkdownCodeBlock } from './MarkdownCodeBlock';

export interface StreamingContentSegment {
  type: 'text' | 'code';
  value: string;
}

const REHYPE_PLUGINS = [remarkGfm, rehypeHighlight];

const MAX_LANGUAGE_TAG_LENGTH = 25;

function stripLanguageTag(code: string): string {
  const newlineIdx = code.indexOf('\n');
  if (newlineIdx === -1) return code;
  const firstLine = code.slice(0, newlineIdx);
  if (
    firstLine.length === 0 ||
    (firstLine.length < MAX_LANGUAGE_TAG_LENGTH && !firstLine.includes(' '))
  ) {
    return code.slice(newlineIdx + 1);
  }
  return code;
}

export function splitStreamingContent(content: string): StreamingContentSegment[] {
  const segments: StreamingContentSegment[] = [];
  const parts = content.split('```');
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i] ?? '';
    if (part.length === 0) continue;
    if (i % 2 === 0) {
      segments.push({ type: 'text', value: part });
    } else {
      segments.push({ type: 'code', value: stripLanguageTag(part) });
    }
  }
  return segments;
}

interface StreamingMarkdownProps {
  content: string;
  isStreaming?: boolean;
}

function StreamingBody({ content }: { content: string }) {
  const segments = splitStreamingContent(content);
  return (
    <>
      {segments.map((segment, i) =>
        segment.type === 'code' ? (
          <MarkdownCodeBlock key={i}>{segment.value}</MarkdownCodeBlock>
        ) : (
          <span key={i} className="whitespace-pre-wrap">
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
