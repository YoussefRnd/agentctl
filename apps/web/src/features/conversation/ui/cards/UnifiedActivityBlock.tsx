import { ActivityBlock, type ActivityBlockProps } from '@/shared/transcript';
import { useSettings } from '@/features/settings';
import { useSession, useSessionTurnState } from '@/features/sessions';

type Props = Omit<ActivityBlockProps, 'showThinking' | 'isCompleted'> & {
  isActive?: boolean;
  isResponding?: boolean;
};

/** Parent session policy stays here; transcript rendering has no session subscription. */
export function UnifiedActivityBlock({ isActive = false, isResponding = false, ...props }: Props) {
  const { settings } = useSettings();
  const { sessionData } = useSession();
  const turn = useSessionTurnState();
  const status = sessionData?.session.status;
  const sessionActive = status === 'running' || status === 'needs_attention' || turn !== null;
  return (
    <ActivityBlock
      {...props}
      showThinking={settings?.showThinking ?? false}
      isCompleted={isResponding || !isActive || !sessionActive}
    />
  );
}
