import { useNotificationStore } from '../stores/useNotificationStore';

export function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return Promise.resolve('denied' as NotificationPermission);
  }
  return Notification.requestPermission();
}

export function sendDesktopNotification({
  title,
  body,
  sessionId,
  type = 'completion',
  onClick,
}: {
  title: string;
  body: string;
  sessionId?: string;
  type?: 'completion' | 'attention';
  onClick?: () => void;
}) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  const { enabled, notifyOnCompletion, notifyOnAttention } = useNotificationStore.getState();
  if (!enabled) return;
  if (type === 'completion' && !notifyOnCompletion) return;
  if (type === 'attention' && !notifyOnAttention) return;

  // Only notify when window is backgrounded / not focused
  if (!document.hidden && document.hasFocus()) return;

  try {
    const notification = new Notification(title, {
      body,
      icon: '/favicon.ico',
    });

    notification.onclick = () => {
      window.focus();
      const electronAPI = (
        window as unknown as {
          electronAPI?: {
            win?: {
              focus?: () => void;
              maximize?: () => void;
            };
          };
        }
      ).electronAPI;

      electronAPI?.win?.focus?.();

      if (onClick) {
        onClick();
      } else if (sessionId) {
        window.location.hash = `#/sessions/${sessionId}`;
      }
      notification.close();
    };
  } catch {
    // Ignore notification errors in environments without notification permission
  }
}
