import { useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import type { Root } from 'hast';
import type { Processor, PluggableList } from 'unified';

function skipParsing(this: Processor) {
  this.parser = () => ({ type: 'root', children: [] });
}
const REMARK_PLUGINS = [skipParsing];

export function PreparedMarkdown({ tree, components }: { tree: Root; components: Components }) {
  const plugins: PluggableList = useMemo(() => [() => () => tree], [tree]);
  // ReactMarkdown still handles raw HTML as text, safe URLs, and custom components.
  // Its parser sees an empty document; the already-prepared HAST replaces it.
  return (
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={plugins} components={components}>
      {''}
    </ReactMarkdown>
  );
}
