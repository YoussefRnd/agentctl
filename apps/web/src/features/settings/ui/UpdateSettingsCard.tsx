import { useUpdate } from '@/features/updates';
import { useAppVersion } from '@/shared';
import { UpdateSettingsPresentation } from './UpdateSettingsPresentation';

export function UpdateSettingsCard() {
  const update = useUpdate();
  const version = useAppVersion();
  return <UpdateSettingsPresentation {...update} version={version} />;
}
