import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth.store';
import {
  fetchNotifications, fetchPreferences, markAllNotificationsRead, markNotificationRead,
  notificationPermission, showBrowserNotification, type AppNotification,
} from '@/lib/notifications';

// The one place notifications are polled.
//
// **Why polling, and why 15 seconds.** There is no socket in this app; the Inbox
// already polls itself every second, which is right for a screen someone is watching
// and wrong for something running on every page. Fifteen seconds is the compromise: a
// message is noticed while it still feels immediate, and a workspace with ten tabs open
// costs the API forty requests a minute rather than six hundred.
//
// **Mounted once, in AppLayout.** Two components each calling this would each fire the
// browser notification, so the firing lives here and everything else reads the cache.

const POLL_MS = 15_000;

/** Where the tab's title count is stitched in. */
const BASE_TITLE = 'ZunoPilot';

export interface UseNotifications {
  notifications: AppNotification[];
  unread: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
  open: (notification: AppNotification) => void;
}

export const useNotifications = (): UseNotifications => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const token = useAuthStore((s) => s.token);

  const list = useQuery({
    queryKey: ['notifications'],
    queryFn: () => fetchNotifications(30),
    // Signed out means no session to poll with — and the 401 interceptor would bounce
    // the page to /login, so an unguarded poll on the login screen is a redirect loop.
    enabled: Boolean(token),
    refetchInterval: POLL_MS,
    // Keep polling when the tab is hidden: the entire point is being told about things
    // while you are looking elsewhere.
    refetchIntervalInBackground: true,
  });

  const preferences = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: fetchPreferences,
    enabled: Boolean(token),
    staleTime: 60_000,
  });

  const notifications = list.data?.notifications ?? [];
  const unread = list.data?.unread ?? 0;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });

  const readOne = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: invalidate,
  });
  const readAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: invalidate,
  });

  /**
   * Ids already shown as a desktop notification.
   *
   * A ref, not state: writing to it must not re-render, and it deliberately does not
   * survive a reload — after a refresh the badge is the right surface for old news, not
   * a burst of desktop popups for everything unread.
   */
  const announced = useRef<Set<string>>(new Set());
  /** True until the first poll has been seen, so a page load does not announce a backlog. */
  const primed = useRef(false);

  useEffect(() => {
    if (!list.data) return;

    // First result after mount: record what already exists and announce none of it.
    if (!primed.current) {
      for (const n of notifications) announced.current.add(n.id);
      primed.current = true;
      return;
    }

    const preference = preferences.data?.preference;
    if (preference && !preference.browser) return;
    if (notificationPermission() !== 'granted') return;

    for (const notification of notifications) {
      if (notification.readAt) continue;
      if (announced.current.has(notification.id)) continue;
      announced.current.add(notification.id);

      // Only when the tab is not the one being looked at. Someone reading the Inbox
      // does not need a popup about the message that just appeared in front of them.
      if (document.visibilityState === 'visible') continue;

      showBrowserNotification(notification, (link) => {
        if (link) navigate(link);
      });
    }
  }, [list.data, notifications, preferences.data, navigate]);

  // The tab title, so a background tab shows the count without being read.
  useEffect(() => {
    document.title = unread > 0 ? `(${unread}) ${BASE_TITLE}` : BASE_TITLE;
    return () => { document.title = BASE_TITLE; };
  }, [unread]);

  return {
    notifications,
    unread,
    markRead: (id: string) => readOne.mutate(id),
    markAllRead: () => readAll.mutate(),
    open: (notification: AppNotification) => {
      if (!notification.readAt) readOne.mutate(notification.id);
      if (notification.link) navigate(notification.link);
    },
  };
};
