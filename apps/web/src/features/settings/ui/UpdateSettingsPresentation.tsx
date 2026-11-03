import { UpdateSettingsLayout } from './GeneralSettingsLayout';
import { RefreshCw } from 'lucide-react';
import { Button, Progress } from '@agentctl/ui';
import type { UpdateState } from '@/electron';

export function UpdateSettingsPresentation({
  state,
  version,
  check,
  install,
}: {
  state: UpdateState;
  version: string;
  check: () => void;
  install: () => void;
}) {
  const updatable =
    state.status === 'available' || state.status === 'downloading' || state.status === 'downloaded';
  const updateVersion = 'version' in state ? state.version : '';

  return (
    <UpdateSettingsLayout
      version={version ? `Current version v${version}` : 'Reading version…'}
      action={
        <Button
          variant="outline"
          size="sm"
          onClick={check}
          className="flex shrink-0 items-center gap-2"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          CHECK
        </Button>
      }
    >
      {updatable && (
        <div className="bg-accent/10 flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-2">
          <span className="text-accent min-w-0 text-[12px] font-medium [overflow-wrap:anywhere]">
            {state.status === 'downloading'
              ? `Downloading… ${Math.round(state.percent).toString()}%`
              : state.status === 'downloaded'
                ? `Update ready: v${updateVersion}`
                : `Update available: v${updateVersion}`}
          </span>
          {state.status === 'downloaded' && (
            <Button variant="solid" size="sm" onClick={install}>
              UPDATE & RESTART
            </Button>
          )}
          {state.status === 'downloading' && (
            <Progress
              label="Application update download"
              value={state.percent}
              className="w-full"
            />
          )}
        </div>
      )}
      {state.status === 'up-to-date' && (
        <p className="text-success text-[11px] font-medium">You&rsquo;re up to date.</p>
      )}
      {state.status === 'error' && (
        <p className="text-danger text-[11px] font-medium">Update check failed: {state.message}</p>
      )}
    </UpdateSettingsLayout>
  );
}
