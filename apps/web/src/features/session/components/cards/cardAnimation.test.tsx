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
