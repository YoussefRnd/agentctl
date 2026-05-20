import { Component, type ReactNode } from 'react';

interface AppErrorBoundaryProps {
  children: ReactNode;
  onRetry: () => void;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  handleRetry = () => {
    this.setState({ hasError: false });
    this.props.onRetry();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full w-full items-center justify-center p-4 sm:p-8">
          <div className="border-border bg-surface/95 w-full max-w-lg rounded-xl border p-6 text-center shadow-2xl">
            <h1 className="text-xl font-semibold">Something went wrong</h1>
            <p className="text-text-muted mt-2 text-sm">
              The app crashed while rendering. Retry to clear state and reload the workspace.
            </p>
            <button
              type="button"
              onClick={this.handleRetry}
              className="bg-accent text-background hover:bg-accent-hover mt-6 inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
