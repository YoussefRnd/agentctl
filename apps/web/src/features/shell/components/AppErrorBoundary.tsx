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
        <div className="flex h-full w-full items-center justify-center p-4">
          <div className="liquid-glass w-full max-w-md rounded-sm p-6 text-center shadow-2xl">
            <h1 className="text-xl font-black tracking-widest text-white uppercase">
              CRITICAL_SYSTEM_FAILURE
            </h1>
            <p className="text-text-muted mt-2 text-[11px] font-bold tracking-tight uppercase opacity-60">
              A_RENDERING_EXCEPTION_HAS_OCCURRED_IN_THE_WORKSPACE_CORE.
            </p>
            <button
              type="button"
              onClick={this.handleRetry}
              className="terminal-button mt-6 !h-10 !px-6"
            >
              REBOOT_WORKSPACE
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
