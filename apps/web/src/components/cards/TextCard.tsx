import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';

export function TextCard({ content }: { content: string }) {
  return (
    <div className="py-4 px-6 mb-2">
      <div className="text-[14px] leading-relaxed prose prose-invert prose-p:text-text-main/90 prose-pre:bg-surface prose-pre:border prose-pre:border-border prose-pre:rounded-xl max-w-none">
        <ReactMarkdown rehypePlugins={[rehypeHighlight]}>{content}</ReactMarkdown>
      </div>
    </div>
  );
}
