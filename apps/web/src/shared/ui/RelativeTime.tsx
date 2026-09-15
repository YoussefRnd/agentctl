import { useEffect, useState } from 'react';

type Timestamp = string | Date | null | undefined;

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

function timestampValue(value: Timestamp): number | null {
  if (!value) return null;
  const timestamp = typeof value === 'string' ? new Date(value).getTime() : value.getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

export function formatRelativeTime(value: Timestamp, now = Date.now()): string {
  const timestamp = timestampValue(value);
  if (timestamp === null) return '';

  const age = Math.max(0, now - timestamp);
  if (age < 5 * SECOND) return 'just now';
  if (age < MINUTE) return `${Math.floor(age / SECOND)}s`;
  if (age < HOUR) return `${Math.floor(age / MINUTE)}m`;
  if (age < DAY) return `${Math.floor(age / HOUR)}h`;
  if (age < WEEK) return `${Math.floor(age / DAY)}d`;

  const date = new Date(timestamp);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(!sameYear && { year: 'numeric' }),
  });
}

/** Returns the delay until the displayed relative-time label can next change. */
export function getRelativeTimeRefreshDelay(value: Timestamp, now = Date.now()): number | null {
  const timestamp = timestampValue(value);
  if (timestamp === null) return null;

  // Treat small clock differences as "just now", then refresh once the timestamp is in the past.
  if (timestamp > now) return timestamp - now + 5 * SECOND;

  const age = now - timestamp;
  if (age < 5 * SECOND) return 5 * SECOND - age;
  if (age < MINUTE) return SECOND - (age % SECOND);
  if (age < HOUR) return MINUTE - (age % MINUTE);
  if (age < DAY) return HOUR - (age % HOUR);
  if (age < WEEK) return DAY - (age % DAY);
  return null;
}

interface RelativeTimeProps {
  value: Timestamp;
  className?: string;
}

export function RelativeTime({ value, className }: RelativeTimeProps) {
  const [now, setNow] = useState(() => Date.now());
  const timestamp = timestampValue(value);

  useEffect(() => {
    if (timestamp === null) return;

    let timer: ReturnType<typeof setTimeout> | undefined;

    const scheduleRefresh = () => {
      const currentTime = Date.now();
      setNow(currentTime);
      const delay = getRelativeTimeRefreshDelay(new Date(timestamp), currentTime);
      if (delay !== null) timer = setTimeout(scheduleRefresh, Math.max(50, delay));
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        if (timer) clearTimeout(timer);
        scheduleRefresh();
      }
    };

    scheduleRefresh();
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [timestamp]);

  if (timestamp === null) return null;

  const date = new Date(timestamp);
  const label = formatRelativeTime(date, now);
  const exactTime = date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  });

  return (
    <time className={className} dateTime={date.toISOString()} title={exactTime}>
      {label}
    </time>
  );
}
