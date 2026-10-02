import { highlightLine } from './code-highlighter';
import type { HighlightRequest, HighlightResult } from './diff-highlighter';

self.onmessage = (event: MessageEvent<HighlightRequest[]>) => {
  const results: HighlightResult[] = event.data.map(({ key, code, language }) => ({
    key,
    html: highlightLine(code, language),
  }));
  self.postMessage(results);
};
