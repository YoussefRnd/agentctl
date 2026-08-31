// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendDesktopNotification, requestNotificationPermission } from './notifications';

describe('notifications', () => {
  const originalNotification = globalThis.Notification;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.Notification = originalNotification;
  });

  it('requestNotificationPermission calls Notification.requestPermission', async () => {
    const mockRequestPermission = vi.fn().mockResolvedValue('granted');
    globalThis.Notification = {
      requestPermission: mockRequestPermission,
      permission: 'default',
    } as unknown as typeof Notification;

    const result = await requestNotificationPermission();
    expect(result).toBe('granted');
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
  });

  it('sendDesktopNotification dispatches notification when backgrounded and granted', () => {
    const mockNotificationConstructor = vi.fn();
    globalThis.Notification = Object.assign(mockNotificationConstructor, {
      permission: 'granted',
      requestPermission: vi.fn(),
    }) as unknown as typeof Notification;

    // Simulate document being hidden / backgrounded
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });

    sendDesktopNotification({
      title: 'Task Complete',
      body: 'All done',
      sessionId: 'session-123',
    });

    expect(mockNotificationConstructor).toHaveBeenCalledWith('Task Complete', {
      body: 'All done',
      icon: '/favicon.ico',
    });
  });

  it('sendDesktopNotification does not dispatch when permission is not granted', () => {
    const mockNotificationConstructor = vi.fn();
    globalThis.Notification = Object.assign(mockNotificationConstructor, {
      permission: 'denied',
      requestPermission: vi.fn(),
    }) as unknown as typeof Notification;

    Object.defineProperty(document, 'hidden', { value: true, configurable: true });

    sendDesktopNotification({
      title: 'Task Complete',
      body: 'All done',
      sessionId: 'session-123',
    });

    expect(mockNotificationConstructor).not.toHaveBeenCalled();
  });
});
