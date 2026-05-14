import React, { Component } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { AppErrorBoundary } from './AppErrorBoundary';

class CrashOnRender extends Component<{ shouldCrash: boolean }> {
  render() {
    if (this.props.shouldCrash) {
      throw new Error('boom');
    }

    return <div>Safe content</div>;
  }
}

describe('AppErrorBoundary', () => {
  it('shows a retry button and recovers after retry', () => {
    const onRetry = vi.fn();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    function Harness() {
      const [shouldCrash, setShouldCrash] = React.useState(true);

      return (
        <AppErrorBoundary onRetry={() => {
          onRetry();
          setShouldCrash(false);
        }}>
          <CrashOnRender shouldCrash={shouldCrash} />
        </AppErrorBoundary>
      );
    }

    render(<Harness />);

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Safe content')).toBeInTheDocument();

    errorSpy.mockRestore();
  });
});
