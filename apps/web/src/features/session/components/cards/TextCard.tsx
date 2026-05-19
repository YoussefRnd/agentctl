import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';

export const TextCard = memo(function TextCard({ content }: { content: string }) {
  return (
    <div className="relative pl-14 pr-6 py-4 my-1 group">
      <div className="absolute left-8 top-7 -translate-y-1/2 -translate-x-[2.5px] w-1.5 h-1.5 rounded-full bg-white/20 border border-white/40 ring-4 ring-background z-10 transition-transform duration-300 group-hover:scale-150" />

      <div className="text-[14px] leading-relaxed font-sans prose prose-invert prose-p:text-text-main/90 prose-headings:text-text-main prose-strong:text-text-main prose-code:text-accent/90 prose-pre:bg-black/40 prose-pre:backdrop-blur-xl prose-pre:border prose-pre:border-white/10 prose-pre:rounded-md max-w-none">
        <ReactMarkdown rehypePlugins={[rehypeHighlight]}>{content}</ReactMarkdown>
      </div>
    </div>
  );
});
