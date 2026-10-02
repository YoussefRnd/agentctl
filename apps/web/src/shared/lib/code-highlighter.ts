import hljs from 'highlight.js';

// Optional grammar processing must not stall scrolling on generated lines.
import { escapeHtml, MAX_SYNTAX_LINE_LENGTH } from './code-highlighter-utils';
export { getLanguageForPath } from './code-highlighter-utils';
const HIGHLIGHT_CACHE_BYTES = 1024 * 1024;
const highlightCache = new Map<string, string>();
let highlightCacheBytes = 0;

export function highlightLine(code: string, language?: string): string {
  if (!code) return '&nbsp;';
  if (!language || code.length > MAX_SYNTAX_LINE_LENGTH || !hljs.getLanguage(language))
    return escapeHtml(code);
  const key = `${language}\0${code}`;
  const cached = highlightCache.get(key);
  if (cached !== undefined) {
    highlightCache.delete(key);
    highlightCache.set(key, cached);
    return cached;
  }
  let html: string;
  try {
    html = hljs.highlight(code, { language, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(code);
  }
  const bytes = (key.length + html.length) * 2;
  if (bytes <= HIGHLIGHT_CACHE_BYTES) {
    while (highlightCacheBytes + bytes > HIGHLIGHT_CACHE_BYTES) {
      const oldest = highlightCache.entries().next().value!;
      highlightCacheBytes -= (oldest[0].length + oldest[1].length) * 2;
      highlightCache.delete(oldest[0]);
    }
    highlightCache.set(key, html);
    highlightCacheBytes += bytes;
  }
  return html;
}
