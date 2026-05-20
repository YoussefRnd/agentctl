import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';

export const TextCard = memo(function TextCard({ content }: { content: string }) {
  return (
    <div className="group relative my-1 py-4 pr-6 pl-14">
      <div className="ring-background absolute top-7 left-8 z-10 h-1.5 w-1.5 -translate-x-[2.5px] -translate-y-1/2 rounded-full border border-white/40 bg-white/20 ring-4 transition-transform duration-300 group-hover:scale-150" />

      <div className="prose prose-invert prose-p:text-text-main/90 prose-headings:text-text-main prose-strong:text-text-main prose-code:text-accent/90 prose-pre:bg-black/40 prose-pre:backdrop-blur-xl prose-pre:border prose-pre:border-white/10 prose-pre:rounded-md max-w-none font-sans text-[14px] leading-relaxed">
        <ReactMarkdown rehypePlugins={[rehypeHighlight]}>{content}</ReactMarkdown>
      </div>
    </div>
  );
});
