import { RefreshCw } from 'lucide-react';
import { Button, Card } from '@agentctl/ui';
import { useUpdate } from '@/features/updates';
import { useAppVersion } from '@/shared';

export function UpdateSettingsCard() {
  const { state, install, check } = useUpdate();
  const version = useAppVersion();

  const updatable =
    state.status === 'available' || state.status === 'downloading' || state.status === 'downloaded';
  const updateVersion = 'version' in state ? state.version : '';

  return (
    <Card className="hover:border-accent/20 flex flex-col gap-3 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-text-main text-[13px] font-bold tracking-tight">Updates</p>
          <p className="text-text-muted mt-0.5 text-[11px] leading-normal opacity-85">
            {version ? `Current version v${version}` : 'Reading version…'}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={check}
          className="flex shrink-0 items-center gap-2"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          CHECK
        </Button>
      </div>

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
        </div>
      )}

      {state.status === 'up-to-date' && (
        <p className="text-success text-[11px] font-medium">You&rsquo;re up to date.</p>
      )}
      {state.status === 'error' && (
        <p className="text-danger text-[11px] font-medium">Update check failed: {state.message}</p>
      )}
    </Card>
  );
}
