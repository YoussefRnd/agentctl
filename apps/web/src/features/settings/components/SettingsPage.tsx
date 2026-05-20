import { AgentCard } from './AgentCard';
import { useDrivers } from '../../../hooks/useDrivers';
import { Loader2, RefreshCw } from 'lucide-react';

export function SettingsPage() {
  const { drivers, activate, syncDrivers, isLoadingDrivers, isSyncing } = useDrivers(null);

  return (
    <div className="animate-fade-in-up relative mx-auto h-full w-full max-w-4xl overflow-y-auto p-8">
      <div className="bg-accent-glow/20 pointer-events-none absolute top-0 right-0 h-[500px] w-[500px] rounded-full opacity-50 blur-[120px]" />
      <div className="relative z-10 mb-10 flex items-center justify-between">
        <div>
          <h1 className="font-display from-text-main to-text-muted bg-gradient-to-br bg-clip-text text-3xl font-bold text-transparent">
            Providers
          </h1>
          <p className="text-text-muted mt-2">Activate and configure your AI agent providers.</p>
        </div>
        <button
          onClick={() => {
            syncDrivers();
          }}
          disabled={isSyncing}
          className="bg-surface-tertiary hover:shadow-accent/20 hover:bg-surface-hover group flex items-center gap-2 rounded-xl border border-white/5 px-4 py-2.5 text-sm font-semibold shadow-white/5 transition-all hover:border-white/10 hover:shadow-lg disabled:opacity-50"
        >
          {isSyncing ? (
            <Loader2 className="text-accent h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="text-text-muted h-4 w-4 transition-transform duration-500 group-hover:rotate-180" />
          )}
          Re-sync All
        </button>
      </div>

      <div className="relative z-10 space-y-4">
        {isLoadingDrivers ? (
          <div className="animate-pulse space-y-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-surface-tertiary border-border-main h-20 rounded-xl border"
              />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:gap-6">
            {drivers.map((driver) => (
              <AgentCard
                key={driver.id}
                driver={driver}
                onActivate={activate}
                onResync={() => {
                  syncDrivers();
                }}
              />
            ))}
            {drivers.length === 0 && (
              <div className="bg-surface-tertiary border-border-main text-text-muted rounded-xl border p-12 text-center">
                No agents found. Try re-syncing.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
