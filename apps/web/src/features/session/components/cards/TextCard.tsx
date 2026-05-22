import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';

export const TextCard = memo(function TextCard({ content }: { content: string }) {
  return (
    <div className="group relative py-2 pr-4 pl-16">
      <div className="absolute top-6 left-10 z-10 h-1 w-1 -translate-x-1/2 -translate-y-1/2 bg-white/40 ring-2 ring-black transition-all duration-300 group-hover:scale-150 group-hover:bg-white" />

      <div className="prose prose-invert prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-white/5 prose-pre:rounded-sm max-w-none text-[13px] leading-6 tracking-tight">
        <ReactMarkdown rehypePlugins={[rehypeHighlight]}>{content}</ReactMarkdown>
      </div>
    </div>
  );
});


