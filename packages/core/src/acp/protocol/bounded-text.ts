/** Retain a UTF-8 suffix without splitting a code point. */
export function boundedText(value: string, limit: number): string {
  const bytes = Buffer.from(value);
  if (bytes.length <= limit) return value;
  let start = bytes.length - limit;
  while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start++;
  return bytes.subarray(start).toString();
}
