export interface StreamingContentSegment {
  key: string;
  type: 'text' | 'code';
  value: string;
}

const MAX_LANGUAGE_TAG_LENGTH = 25;

export function stripLanguageTag(code: string): string {
  const newlineIdx = code.indexOf('\n');
  if (newlineIdx === -1) return code;
  const firstLine = code.slice(0, newlineIdx);
  if (
    firstLine.length === 0 ||
    (firstLine.length < MAX_LANGUAGE_TAG_LENGTH && !firstLine.includes(' '))
  ) {
    return code.slice(newlineIdx + 1);
  }
  return code;
}

export function splitStreamingContent(content: string): StreamingContentSegment[] {
  const segments: StreamingContentSegment[] = [];
  const parts = content.split('```');
  let offset = 0;

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i] ?? '';
    if (part.length === 0) continue;

    const startOffset = offset;
    offset += part.length;

    if (i % 2 !== 0) {
      // Code segment
      segments.push({
        key: `seg-${String(startOffset)}`,
        type: 'code',
        value: stripLanguageTag(part),
      });
    } else {
      // Text segment: split by double-newline paragraphs for fine-grained memoization
      if (part.includes('\n\n')) {
        let textOffset = startOffset;
        let remaining = part;
        let matchIdx: number;

        while ((matchIdx = remaining.indexOf('\n\n')) !== -1) {
          let newlineCount = 2;
          while (
            matchIdx + newlineCount < remaining.length &&
            remaining[matchIdx + newlineCount] === '\n'
          ) {
            newlineCount++;
          }

          const paragraphWithNewlines = remaining.slice(0, matchIdx + newlineCount);
          if (paragraphWithNewlines.length > 0) {
            segments.push({
              key: `seg-${String(textOffset)}`,
              type: 'text',
              value: paragraphWithNewlines,
            });
            textOffset += paragraphWithNewlines.length;
          }
          remaining = remaining.slice(matchIdx + newlineCount);
        }

        if (remaining.length > 0) {
          segments.push({
            key: `seg-${String(textOffset)}`,
            type: 'text',
            value: remaining,
          });
        }
      } else {
        segments.push({
          key: `seg-${String(startOffset)}`,
          type: 'text',
          value: part,
        });
      }
    }
  }

  return segments;
}
