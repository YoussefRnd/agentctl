import { useSettingsOverlayStore } from '../model/useSettingsOverlayStore';
import { GeneralSettingsView } from './GeneralSettingsView';
import { ProvidersSettingsView } from './ProvidersSettingsView';
import { McpSettings } from './McpSettings';

/** Deferred settings content; the dialog frame stays mounted while this loads. */
export function SettingsDialogContent() {
  const settingsTab = useSettingsOverlayStore((s) => s.settingsTab);
  return (
    <>
      {settingsTab === 'general' && <GeneralSettingsView />}
      {settingsTab === 'providers' && <ProvidersSettingsView />}
      {settingsTab === 'mcp' && <McpSettings />}
    </>
  );
}
