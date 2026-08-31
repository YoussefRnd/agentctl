import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface NotificationState {
  enabled: boolean;
  notifyOnCompletion: boolean;
  notifyOnAttention: boolean;
  setEnabled: (enabled: boolean) => void;
  setNotifyOnCompletion: (enabled: boolean) => void;
  setNotifyOnAttention: (enabled: boolean) => void;
}

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set) => ({
      enabled: true,
      notifyOnCompletion: true,
      notifyOnAttention: true,
      setEnabled: (enabled) => set({ enabled }),
      setNotifyOnCompletion: (notifyOnCompletion) => set({ notifyOnCompletion }),
      setNotifyOnAttention: (notifyOnAttention) => set({ notifyOnAttention }),
    }),
    {
      name: 'agentctl:notification_settings',
    },
  ),
);
