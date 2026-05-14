import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';

export function TextCard({ content }: { content: string }) {
  return (
    <div className="p-4 border-l-2 border-accent bg-surface/30 my-2">
      <div className="text-sm prose prose-invert max-w-none">
        <ReactMarkdown rehypePlugins={[rehypeHighlight]}>{content}</ReactMarkdown>
      </div>
    </div>
  );
}
