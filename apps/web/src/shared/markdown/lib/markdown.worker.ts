import { prepareMarkdown, type MarkdownRequest, type MarkdownResult } from './markdownProcessor';

self.onmessage = (event: MessageEvent<MarkdownRequest>) => {
  const { id, content } = event.data;
  let result: MarkdownResult;
  try {
    result = { id, tree: prepareMarkdown(content) };
  } catch (error) {
    result = { id, error: error instanceof Error ? error.message : String(error) };
  }
  self.postMessage(result);
};
