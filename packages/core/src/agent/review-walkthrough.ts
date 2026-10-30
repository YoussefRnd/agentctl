import type { ReviewFile, ReviewWalkthroughStop } from '@agentctl/shared';
/** Validate all locations against captured hunks. Coverage is an index, never proof of model attention. */
export function normalizeReviewWalkthrough(
  stops: ReviewWalkthroughStop[] | undefined,
  files: ReviewFile[],
) {
  if (!stops) return undefined;
  if (stops.length > 8) throw new Error('The walkthrough has too many stops.');
  const paths = new Set(files.map((file) => file.path));
  const covered = new Set<string>();
  const result = stops.map((stop) => {
    for (const path of stop.files) {
      if (!paths.has(path))
        throw new Error('Walkthrough references a file outside the captured diff.');
      covered.add(path);
    }
    for (const excerpt of stop.excerpts) {
      const file = files.find((file) => file.path === excerpt.path);
      const valid =
        file &&
        [...file.diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].some((hunk) => {
          const start = Number(hunk[excerpt.side === 'old' ? 1 : 3]);
          const count = Number(hunk[excerpt.side === 'old' ? 2 : 4] ?? 1);
          return excerpt.line >= start && excerpt.line < start + count;
        });
      if (!valid || (file!.state === 'deleted' && excerpt.side !== 'old'))
        throw new Error('Walkthrough excerpt is outside the captured diff.');
      covered.add(excerpt.path);
    }
    return { ...stop, files: [...new Set(stop.files)] };
  });
  const rest = [...paths].filter((path) => !covered.has(path));
  if (rest.length)
    result.push({
      title: 'Other changed files',
      summary:
        'These files were not covered by the generated explanations. Inspect their captured changes separately.',
      excerpts: [],
      files: rest,
    });
  return result;
}
