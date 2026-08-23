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
    const key = `seg-${String(offset)}`;
    offset += part.length;
    if (i % 2 === 0) {
      segments.push({ key, type: 'text', value: part });
    } else {
      segments.push({ key, type: 'code', value: stripLanguageTag(part) });
    }
  }
  return segments;
}
