import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeHighlight from 'rehype-highlight';
import type { Root } from 'hast';

// Match ReactMarkdown's full-document pipeline, including reference resolution.
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeHighlight);

export function prepareMarkdown(content: string): Root {
  return processor.runSync(processor.parse(content)) as Root;
}

export interface MarkdownRequest {
  id: number;
  content: string;
}
export type MarkdownResult = { id: number; tree: Root } | { id: number; error: string };
