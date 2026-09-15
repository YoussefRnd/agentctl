import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { CommandResultCard } from './CommandResultCard';
import { TimelineEvent } from './TimelineEvent';

describe('chat cards rendered inside the virtualized feed', () => {
  it('must not apply enter animations that replay when Virtuoso recycles items', () => {
    const commandHtml = renderToString(<CommandResultCard command="ls" isStreaming />);
    expect(commandHtml).not.toContain('animate-in');

    const timelineHtml = renderToString(
      <TimelineEvent dotColor="bg-red-400">
        <span>activity</span>
      </TimelineEvent>,
    );
    expect(timelineHtml).not.toContain('animate-in');
  });
});

describe('TimelineEvent tree and branch connectors', () => {
  it('renders no trunks for position="only"', () => {
    const html = renderToString(
      <TimelineEvent dotColor="bg-blue-400" position="only">
        <span>single event</span>
      </TimelineEvent>,
    );
    expect(html).not.toContain('data-testid="timeline-top-trunk"');
    expect(html).not.toContain('data-testid="timeline-bottom-trunk"');
    expect(html).not.toContain('data-testid="timeline-branch-arm"');
  });

  it('renders bottom trunk only for position="first"', () => {
    const html = renderToString(
      <TimelineEvent dotColor="bg-blue-400" position="first">
        <span>first event</span>
      </TimelineEvent>,
    );
    expect(html).not.toContain('data-testid="timeline-top-trunk"');
    expect(html).toContain('data-testid="timeline-bottom-trunk"');
    expect(html).not.toContain('data-testid="timeline-branch-arm"');
  });

  it('renders both top and bottom trunks for middle item', () => {
    const html = renderToString(
      <TimelineEvent dotColor="bg-blue-400" position="middle">
        <span>middle event</span>
      </TimelineEvent>,
    );
    expect(html).toContain('data-testid="timeline-top-trunk"');
    expect(html).toContain('data-testid="timeline-bottom-trunk"');
    expect(html).not.toContain('data-testid="timeline-branch-arm"');
  });

  it('renders top trunk and branch arm for position="last"', () => {
    const html = renderToString(
      <TimelineEvent dotColor="bg-blue-400" position="last">
        <span>last event</span>
      </TimelineEvent>,
    );
    expect(html).toContain('data-testid="timeline-top-trunk"');
    expect(html).not.toContain('data-testid="timeline-bottom-trunk"');
    expect(html).toContain('data-testid="timeline-branch-arm"');
  });
});
