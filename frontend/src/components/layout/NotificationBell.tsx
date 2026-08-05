import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { AppNotification, NotificationKind } from '@/lib/notifications';
import { Bell, CheckCheck, MessageSquare, ShoppingBag, UserRoundSearch } from 'lucide-react';

// The bell.
//
// **Reads state, owns none.** `useNotifications` is mounted once in `AppLayout` and
// this is handed the result, because two components each polling would double the
// requests and — worse — each fire their own desktop notification for one message.
//
// There is no desktop header in this shell; the sidebar is the chrome. So this appears
// twice: in the sidebar footer above the profile row, and in the mobile header where a
// person on a phone expects it.

const KIND_ICON: Record<NotificationKind, typeof Bell> = {
  MESSAGE_RECEIVED: MessageSquare,
  HANDOFF_REQUESTED: UserRoundSearch,
  ORDER_CREATED: ShoppingBag,
};

/** "just now", "4m", "3h", "2d" — short enough for a 320px dropdown. */
const ago = (iso: string): string => {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
};

export function NotificationBell({
  notifications, unread, onOpen, onMarkAllRead, collapsed = false, className,
}: {
  notifications: AppNotification[];
  unread: number;
  onOpen: (notification: AppNotification) => void;
  onMarkAllRead: () => void;
  /** Sidebar rail state. Hides the label, keeps the count. */
  collapsed?: boolean;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Notifications"
          // The count belongs in the accessible name, not only in a coloured dot —
          // otherwise the one thing the control is communicating is the one thing a
          // screen reader does not get.
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
          className={cn(
            'relative flex items-center gap-3 rounded-md px-2 py-2 text-sm text-ink-500',
            'transition-colors duration-micro hover:bg-accent-100/40 hover:text-ink-900',
            collapsed ? 'w-full lg:justify-center lg:px-0' : 'w-full',
            className,
          )}
        >
          <span className="relative shrink-0">
            <Bell className="h-4 w-4" />
            {unread > 0 && (
              // A dot, not a number, on the icon itself: at 16px a two-digit count is
              // unreadable, and the exact figure is on the row and in the tab title.
              <span
                aria-hidden
                className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-danger"
              />
            )}
          </span>
          <span className={cn('whitespace-nowrap', collapsed && 'lg:hidden')}>
            Notifications
          </span>
          {unread > 0 && (
            <span className={cn(
              'ml-auto rounded-full bg-danger px-2 text-caption font-medium text-surface-1',
              collapsed && 'lg:hidden',
            )}>
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-ink-300 px-3 py-2">
          <span className="text-sm font-medium text-ink-900">Notifications</span>
          {unread > 0 && (
            <button
              type="button"
              onClick={onMarkAllRead}
              className="flex items-center gap-1 text-caption text-accent-700 hover:underline"
            >
              <CheckCheck className="h-3 w-3" />
              Mark all read
            </button>
          )}
        </div>

        {notifications.length === 0 ? (
          <p className="px-3 py-6 text-center text-caption text-ink-500">
            Nothing yet. New WhatsApp messages will show up here.
          </p>
        ) : (
          <ul className="max-h-96 overflow-y-auto">
            {notifications.map((notification) => {
              const Icon = KIND_ICON[notification.kind] ?? Bell;
              const isUnread = !notification.readAt;
              return (
                <li key={notification.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(notification)}
                    className={cn(
                      'flex w-full items-start gap-3 border-b border-ink-300 px-3 py-2 text-left',
                      'transition-colors duration-micro hover:bg-accent-100/40',
                      isUnread && 'bg-accent-100/20',
                    )}
                  >
                    <Icon className={cn(
                      'mt-px h-4 w-4 shrink-0',
                      isUnread ? 'text-accent-600' : 'text-ink-500',
                    )} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={cn(
                          'truncate text-sm',
                          isUnread ? 'font-medium text-ink-900' : 'text-ink-700',
                        )}>
                          {notification.title}
                        </span>
                        <span className="shrink-0 text-caption text-ink-500">
                          {ago(notification.createdAt)}
                        </span>
                      </span>
                      <span className="mt-px block truncate text-caption text-ink-500">
                        {notification.body}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
