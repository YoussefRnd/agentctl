import { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw, Copy, Check } from 'lucide-react';
import { Button } from '@agentctl/ui';

interface AppErrorBoundaryProps {
  children: ReactNode;
  onRetry: () => void;
}

interface AppErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  copied: boolean;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    hasError: false,
    error: null,
    copied: false,
  };

  private copyTimeout: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(error: Error): Partial<AppErrorBoundaryState> {
    return { hasError: true, error, copied: false };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[AppErrorBoundary] Uncaught rendering error:', error, errorInfo);
  }

  override componentWillUnmount() {
    if (this.copyTimeout) {
      clearTimeout(this.copyTimeout);
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, copied: false });
    this.props.onRetry();
  };

  handleCopyError = () => {
    const errorText = [this.state.error?.name, this.state.error?.message, this.state.error?.stack]
      .filter(Boolean)
      .join('\n\n');

    if (errorText && typeof navigator !== 'undefined') {
      void navigator.clipboard.writeText(errorText);
      this.setState({ copied: true });
      if (this.copyTimeout) clearTimeout(this.copyTimeout);
      this.copyTimeout = setTimeout(() => this.setState({ copied: false }), 2000);
    }
  };

  override render() {
    if (this.state.hasError) {
      return (
        <div className="bg-brand-base/80 flex min-h-screen w-full items-center justify-center p-6">
          <div className="liquid-glass border-border/40 w-full max-w-md rounded-2xl border p-6 text-center shadow-2xl backdrop-blur-xl">
            {/* Warning Icon Badge */}
            <div className="bg-danger/10 text-danger border-danger/20 mx-auto mb-3.5 flex h-11 w-11 items-center justify-center rounded-full border shadow-sm">
              <AlertTriangle className="icon-prominent" />
            </div>

            <h1 className="text-role-title text-text-main text-base">Something went wrong</h1>
            <p className="text-role-body text-text-muted mt-1.5 leading-relaxed">
              An unexpected error occurred while rendering the workspace. You can reload the
              workspace or restart the application to continue.
            </p>

            {/* Expandable Error Details */}
            {this.state.error?.message && (
              <div className="border-border/30 bg-surface/50 mt-4 rounded-xl border p-3 text-left">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-role-eyebrow text-text-muted/70">Error Details</span>
                  <button
                    type="button"
                    onClick={this.handleCopyError}
                    className="text-role-control text-text-muted hover:text-text-main flex cursor-pointer items-center gap-1.5 transition-colors"
                  >
                    {this.state.copied ? (
                      <>
                        <Check className="icon-compact text-success" />
                        <span className="text-success font-medium">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="icon-compact" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
                <pre className="text-role-code text-danger/90 max-h-28 overflow-y-auto leading-snug break-all whitespace-pre-wrap">
                  {this.state.error.message}
                </pre>
              </div>
            )}

            {/* Actions */}
            <div className="mt-6 flex items-center justify-center gap-2.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.location.reload()}
                className="flex items-center gap-1.5 font-semibold"
              >
                <RotateCcw className="icon-compact" />
                Restart App
              </Button>
              <Button
                variant="solid"
                size="sm"
                onClick={this.handleRetry}
                className="flex items-center gap-1.5 font-semibold"
              >
                <RefreshCw className="icon-compact" />
                Reload Workspace
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
