import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';

export const TextCard = memo(function TextCard({ content }: { content: string }) {
 return (
  <div className="group relative py-2 pr-4 pl-16">
   <div className="bg-accent/40 ring-background absolute top-6 left-10 z-10 h-1 w-1 -translate-x-1/2 -translate-y-1/2 ring-2 transition-all duration-300 group-hover:bg-accent group-hover:scale-150 group-hover:shadow-[0_0_8px_rgba(203,166,247,0.5)]" />

   <div className="prose prose-invert prose-pre:bg-surface-secondary/50 prose-pre:border prose-pre:border-border prose-pre:rounded-md max-w-none text-[13px] leading-6 tracking-tight">
    <ReactMarkdown rehypePlugins={[rehypeHighlight]}>{content}</ReactMarkdown>
   </div>
  </div>
 );
});


