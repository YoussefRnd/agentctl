import { RefreshCw } from 'lucide-react';
import type { UpdateState } from '@/electron';

interface UpdateIndicatorProps {
  state: UpdateState;
  onInstall: () => void;
}

export function UpdateIndicator({ state, onInstall }: UpdateIndicatorProps) {
  if (
    state.status !== 'available' &&
    state.status !== 'downloading' &&
    state.status !== 'downloaded'
  ) {
    return null;
  }

  const downloading = state.status === 'downloading' || state.status === 'available';
  const downloaded = state.status === 'downloaded';

  return (
    <button
      type="button"
      onClick={onInstall}
      disabled={downloading}
      title={downloaded ? `Restart to install v${state.version}` : `Downloading update…`}
      className="app-region-no-drag bg-accent/15 text-accent hover:bg-accent/25 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-default disabled:opacity-80"
    >
      {downloading ? (
        <>
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          <span>
            {'percent' in state ? `${Math.round(state.percent).toString()}%` : 'Downloading…'}
          </span>
        </>
      ) : (
        <>
          <span className="font-semibold">{downloaded ? 'Update & Restart' : 'Update'}</span>
          {state.version && <span className="opacity-70">v{state.version}</span>}
        </>
      )}
    </button>
  );
}
