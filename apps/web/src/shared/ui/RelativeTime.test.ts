import { describe, expect, it } from 'vitest';
import { formatRelativeTime, getRelativeTimeRefreshDelay } from './RelativeTime';

const NOW = new Date('2026-09-14T12:00:00.000Z').getTime();

describe('formatRelativeTime', () => {
  it.each([
    [0, 'just now'],
    [4_999, 'just now'],
    [5_000, '5s'],
    [59_999, '59s'],
    [60_000, '1m'],
    [3_599_999, '59m'],
    [3_600_000, '1h'],
    [86_400_000, '1d'],
    [6 * 86_400_000, '6d'],
  ])('formats an age of %i milliseconds as %s', (age, expected) => {
    expect(formatRelativeTime(new Date(NOW - age), NOW)).toBe(expected);
  });

  it('does not turn future timestamps into a negative age', () => {
    expect(formatRelativeTime(new Date(NOW + 30_000), NOW)).toBe('just now');
  });

  it('returns an empty label for an invalid timestamp', () => {
    expect(formatRelativeTime('not-a-date', NOW)).toBe('');
  });
});

describe('getRelativeTimeRefreshDelay', () => {
  it('aligns refreshes with the next visible label boundary', () => {
    expect(getRelativeTimeRefreshDelay(new Date(NOW - 5_250), NOW)).toBe(750);
    expect(getRelativeTimeRefreshDelay(new Date(NOW - 61_250), NOW)).toBe(58_750);
    expect(getRelativeTimeRefreshDelay(new Date(NOW - 3_601_000), NOW)).toBe(3_599_000);
  });

  it('stops scheduling once the label is an absolute date', () => {
    expect(getRelativeTimeRefreshDelay(new Date(NOW - 7 * 86_400_000), NOW)).toBeNull();
  });
});
