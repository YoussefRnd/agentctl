import { AgentCard } from './AgentCard';
import { useDrivers } from '../../../hooks/useDrivers';
import { Loader2, RefreshCw } from 'lucide-react';

export function SettingsPage() {
 const {
  drivers,
  activate,
  syncDrivers,
  isLoadingDrivers,
  isSyncing,
  toggleDriver,
  updateDriverConfig,
  isUpdatingConfig,
 } = useDrivers(null);

 return (
  <div className="relative mx-auto h-full w-full max-w-4xl overflow-y-auto p-4">
   <div className="relative z-10 mb-6 flex items-center justify-between">
    <div>
     <h1 className="text-white text-2xl font-black uppercase tracking-widest">
      SETTINGS::DRIVERS
     </h1>
     <p className="text-text-muted mt-1 text-[11px] font-bold uppercase tracking-tight opacity-60">CONFIGURE_ACTIVE_AI_AGENT_PIPELINES</p>
    </div>
    <button
     onClick={() => {
      syncDrivers();
     }}
     disabled={isSyncing}
     className="terminal-button group flex items-center gap-2"
    >
     {isSyncing ? (
      <Loader2 className="h-3 w-3 animate-spin" />
     ) : (
      <RefreshCw className="h-3 w-3 transition-transform duration-500 group-hover:rotate-180" />
     )}
     SYNC_ALL
    </button>
   </div>

   <div className="relative z-10 space-y-2">
    {isLoadingDrivers ? (
     <div className="animate-pulse space-y-2">
      {[1, 2, 3].map((i) => (
       <div
        key={i}
        className="bg-white/5 border-white/5 h-16 rounded-sm border"
       />
      ))}
     </div>
    ) : (
     <div className="grid gap-2">
      {drivers.map((driver) => (
       <AgentCard
        key={driver.id}
        driver={driver}
        onActivate={activate}
        onToggle={(id, enabled) => {
         toggleDriver({ driverId: id, enabled });
        }}
        onResync={() => {
         syncDrivers();
        }}
        onUpdateConfig={(id, customEnv) => {
         updateDriverConfig({ driverId: id, customEnv });
        }}
        isUpdatingConfig={isUpdatingConfig}
       />
      ))}
      {drivers.length === 0 && (
       <div className="bg-white/5 border-white/5 text-text-muted rounded-sm border p-8 text-center text-[10px] font-bold uppercase tracking-widest opacity-30">
        NO_AGENTS_DETECTED
       </div>
      )}
     </div>
    )}
   </div>
  </div>
 );
}

