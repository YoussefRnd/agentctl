export const decodingScenarios = [
  { count: 200, mixed: false },
  { count: 200, mixed: true },
  { count: 500, mixed: true },
];
export const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** Relative to the preserved decoder on the same process/host, never laptop milliseconds. */
export function evaluateDecoding(samples, limit = 1.25) {
  if (samples.length !== 3 || !Number.isFinite(limit) || limit <= 0)
    throw new Error('Three fresh-process samples and a positive limit are required');
  return decodingScenarios.map(({ count, mixed }) => {
    const ratios = samples.map((sample) => {
      if (!sample.passed || sample.schemaVersion !== 1 || sample.scenarios.length !== 3)
        throw new Error('Incomplete decoder sample');
      const matches = sample.scenarios.filter((row) => row.count === count && row.mixed === mixed);
      if (matches.length !== 1) throw new Error('Missing or duplicate decoder scenario');
      const { fullCandidate, fullReference } = matches[0].medianNs;
      if (![fullCandidate, fullReference].every((ns) => Number.isFinite(ns) && ns > 0))
        throw new Error('Invalid decoder timing');
      return fullCandidate / fullReference;
    });
    const ratio = median(ratios);
    return { count, mixed, ratios, ratio, limit, passed: ratio <= limit };
  });
}
