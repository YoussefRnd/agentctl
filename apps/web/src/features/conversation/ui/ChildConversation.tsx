import type { ComponentProps } from 'react';
import { SubagentChatView } from '@/features/subagents';
import { useSettings } from '@/features/settings';

/** Parent composition supplies preferences; child rendering has no parent-session context. */
export function ChildConversation(props: ComponentProps<typeof SubagentChatView>) {
  const { settings } = useSettings();
  return <SubagentChatView {...props} showThinking={settings?.showThinking ?? false} />;
}
