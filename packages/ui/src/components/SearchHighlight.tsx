import type { ReactNode } from 'react';

export function SearchHighlight({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const target = text.toLowerCase();
  const normalizedQuery = query.trim().toLowerCase();
  const matches = new Set<number>();
  const contiguousStart = target.indexOf(normalizedQuery);
  if (contiguousStart >= 0) {
    for (let offset = 0; offset < normalizedQuery.length; offset++) {
      matches.add(contiguousStart + offset);
    }
  } else {
    let queryIndex = 0;
    for (let index = 0; index < target.length && queryIndex < normalizedQuery.length; index++) {
      if (target[index] === normalizedQuery[queryIndex]) {
        matches.add(index);
        queryIndex++;
      }
    }
    if (queryIndex !== normalizedQuery.length) return <>{text}</>;
  }

  // Group adjacent characters to keep long paths cheap to render.
  const segments: ReactNode[] = [];
  let start = 0;
  while (start < text.length) {
    const matched = matches.has(start);
    let end = start + 1;
    while (end < text.length && matches.has(end) === matched) end++;
    segments.push(
      matched ? (
        <mark key={start} className="text-accent bg-transparent font-semibold">
          {text.slice(start, end)}
        </mark>
      ) : (
        text.slice(start, end)
      ),
    );
    start = end;
  }
  return <>{segments}</>;
}
