import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  fetchNotifications, fetchPreferences, fetchPushDevices, isPushSubscribedHere,
  markAllNotificationsRead, notificationPermission, requestNotificationPermission,
  savePreferences, subscribeToPush, unsubscribeFromPush,
  type NotificationPreference,
} from '@/lib/notifications';
import { Bell, BellOff, CheckCheck, Monitor, Smartphone } from 'lucide-react';

// Settings → Notifications.
//
// **What was here before:** a hardcoded panel reading "No notifications yet — You're
// all caught up! Notifications about your orders, messages, and account activity will
// appear here." It queried nothing and would have said that forever, while the Dashboard
// linked people straight to it. A screen promising a feature that does not exist is
// worse than no screen.
//
// The organising idea is that **three of these settings are per account and one is per
// device**, and conflating them is the usual way notification settings confuse people.
// "Tell me about new messages" follows you everywhere. "Push on this laptop" does not.

/** Per-kind toggles, in the order they matter to someone running a shop. */
const KINDS: Array<{ key: keyof NotificationPreference; label: string; hint: string }> = [
  {
    key: 'messageReceived',
    label: 'New WhatsApp messages',
    hint: 'When a customer writes in.',
  },
  {
    key: 'handoffRequested',
    label: 'A conversation needs a person',
    hint: 'The automation gave up and someone is waiting.',
  },
  {
    key: 'orderCreated',
    label: 'New orders',
    hint: 'When an order is placed over WhatsApp.',
  },
];

const CHANNELS: Array<{ key: keyof NotificationPreference; label: string; hint: string }> = [
  {
    key: 'inApp',
    label: 'In the app',
    hint: 'The bell and the unread count. Always the fastest one.',
  },
  {
    key: 'browser',
    label: 'Desktop notifications',
    hint: 'Only while a ZunoPilot tab is open but not the one you are looking at.',
  },
];

export default function NotificationSettings() {
  const queryClient = useQueryClient();

  const preferences = useQuery({ queryKey: ['notification-preferences'], queryFn: fetchPreferences });
  const list = useQuery({ queryKey: ['notifications'], queryFn: () => fetchNotifications(30) });
  const devices = useQuery({ queryKey: ['push-devices'], queryFn: fetchPushDevices });

  /**
   * Browser permission, held in state because it is not reactive.
   *
   * `Notification.permission` is a snapshot: nothing re-renders when the person grants
   * or blocks it in the browser's own dialog, so it is read once on mount and again
   * after every action that could have changed it.
   */
  const [permission, setPermission] = useState(notificationPermission());
  /** Whether *this* browser holds a push subscription, which the server cannot tell us. */
  const [subscribedHere, setSubscribedHere] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    isPushSubscribedHere().then(setSubscribedHere).catch(() => setSubscribedHere(false));
  }, []);

  const preference = preferences.data?.preference;
  const pushAvailable = preferences.data?.push.available ?? false;
  const publicKey = preferences.data?.push.publicKey ?? null;

  const save = useMutation({
    mutationFn: savePreferences,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notification-preferences'] }),
    onError: () => toast.error('That setting could not be saved'),
  });

  const readAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast.success('Marked everything read');
    },
  });

  const askPermission = async () => {
    const result = await requestNotificationPermission();
    setPermission(result);
    if (result === 'denied') {
      // The browser will not ask twice. Saying so is the only useful thing left.
      toast.error('Notifications are blocked. Allow them in your browser settings for this site.');
    }
  };

  const togglePushHere = async () => {
    setBusy(true);
    try {
      if (subscribedHere) {
        await unsubscribeFromPush();
        setSubscribedHere(false);
        toast.success('Push turned off on this device');
      } else {
        if (!publicKey) return;
        const result = await subscribeToPush(publicKey);
        if (!result.ok) {
          toast.error(result.reason);
          return;
        }
        setSubscribedHere(true);
        queryClient.invalidateQueries({ queryKey: ['notification-preferences'] });
        toast.success('Push turned on for this device');
      }
      queryClient.invalidateQueries({ queryKey: ['push-devices'] });
    } finally {
      setBusy(false);
    }
  };

  const notifications = list.data?.notifications ?? [];
  const unread = list.data?.unread ?? 0;

  return (
    <div className="space-y-3">
      {/* ── What to be told about ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>What you are told about</CardTitle>
          <CardDescription>These follow your account, on every device.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {KINDS.map(({ key, label, hint }) => (
            <div key={key} className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <Label htmlFor={`kind-${key}`} className="text-sm text-ink-900">{label}</Label>
                <p className="mt-px text-caption text-ink-500">{hint}</p>
              </div>
              <Switch
                id={`kind-${key}`}
                checked={Boolean(preference?.[key])}
                disabled={!preference || save.isPending}
                onCheckedChange={(checked) => save.mutate({ [key]: checked })}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── How ───────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>How you are told</CardTitle>
          <CardDescription>
            Turning a kind off above silences it everywhere, whatever is set here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {CHANNELS.map(({ key, label, hint }) => (
            <div key={key} className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <Label htmlFor={`channel-${key}`} className="text-sm text-ink-900">{label}</Label>
                <p className="mt-px text-caption text-ink-500">{hint}</p>
              </div>
              <Switch
                id={`channel-${key}`}
                checked={Boolean(preference?.[key])}
                disabled={!preference || save.isPending}
                onCheckedChange={(checked) => save.mutate({ [key]: checked })}
              />
            </div>
          ))}

          {/* Permission is a browser fact, not a preference, so it gets its own row
              rather than a toggle that would silently do nothing while blocked. */}
          {preference?.browser && permission !== 'granted' && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/15 p-3">
              <Bell className="mt-px h-4 w-4 shrink-0 text-ink-900" />
              <div className="min-w-0 flex-1">
                <p className="text-caption font-medium text-ink-900">
                  {permission === 'denied'
                    ? 'Your browser is blocking notifications'
                    : 'This browser has not been asked yet'}
                </p>
                <p className="mt-px text-caption leading-snug text-ink-900">
                  {permission === 'denied'
                    ? 'Allow notifications for this site in your browser settings — we cannot ask again once blocked.'
                    : 'Desktop notifications need one-off permission from this browser.'}
                </p>
                {permission === 'default' && (
                  <Button size="sm" variant="secondary" className="mt-2" onClick={askPermission}>
                    Allow notifications
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── This device ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Push on this device</CardTitle>
          <CardDescription>
            Reaches you when ZunoPilot is closed. Set per device, not per account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!pushAvailable ? (
            <p className="text-caption leading-snug text-ink-500">
              Push is not configured on this server yet, so there is nothing to turn on.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm text-ink-900">
                    {subscribedHere === null
                      ? 'Checking this device…'
                      : subscribedHere ? 'This device is subscribed' : 'This device is not subscribed'}
                  </p>
                  <p className="mt-px text-caption leading-snug text-ink-500">
                    On iPhone and iPad this only works once ZunoPilot has been added to
                    your home screen — that is a Safari rule, not a setting here.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={subscribedHere ? 'secondary' : 'default'}
                  disabled={busy || subscribedHere === null || permission !== 'granted'}
                  onClick={togglePushHere}
                >
                  {subscribedHere
                    ? <><BellOff className="mr-1 h-3.5 w-3.5" /> Turn off here</>
                    : <><Bell className="mr-1 h-3.5 w-3.5" /> Turn on here</>}
                </Button>
              </div>

              {permission !== 'granted' && (
                <p className="text-caption text-ink-500">
                  Allow notifications above first — push cannot be turned on without it.
                </p>
              )}

              {(devices.data?.length ?? 0) > 0 && (
                <div className="border-t border-ink-300 pt-3">
                  <p className="text-caption font-medium text-ink-700">
                    Subscribed devices ({devices.data?.length})
                  </p>
                  <ul className="mt-1 space-y-1">
                    {devices.data?.map((device) => (
                      <li key={device.id} className="flex items-center gap-2 text-caption text-ink-500">
                        {/*
                          The platform, not a guess from the user agent. A phone registered by the
                          app has no user agent at all, so sniffing it drew a monitor next to
                          "Unknown device" for the one device that knows exactly what it is called.
                        */}
                        {device.platform === 'WEB'
                          ? <Monitor className="h-3 w-3 shrink-0" />
                          : <Smartphone className="h-3 w-3 shrink-0" />}
                        <span className="truncate">
                          {device.deviceName ?? device.userAgent?.slice(0, 60) ?? 'Unknown device'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ── The actual notifications ──────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4">
          <div className="min-w-0">
            <CardTitle>Recent</CardTitle>
            <CardDescription>
              {unread > 0 ? `${unread} unread` : 'Everything here has been read.'}
            </CardDescription>
          </div>
          {unread > 0 && (
            <Button size="sm" variant="secondary" onClick={() => readAll.mutate()}>
              <CheckCheck className="mr-1 h-3.5 w-3.5" /> Mark all read
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {list.isLoading ? (
            <p className="py-6 text-center text-caption text-ink-500">Loading…</p>
          ) : notifications.length === 0 ? (
            // The honest empty state. Says what would put something here, rather than
            // the old "You're all caught up!" on a list that could never fill.
            <div className="py-12 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent-100">
                <Bell className="h-6 w-6 text-accent-700" />
              </div>
              <p className="text-body font-medium text-ink-700">Nothing yet</p>
              <p className="mx-auto mt-1 max-w-xs text-sm text-ink-500">
                The next WhatsApp message a customer sends will appear here, and in the
                bell in the sidebar.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-ink-300">
              {notifications.map((notification) => (
                <li
                  key={notification.id}
                  className={cn('flex items-start gap-3 py-2', !notification.readAt && 'bg-accent-100/20')}
                >
                  <span className="min-w-0 flex-1">
                    <span className={cn(
                      'block truncate text-sm',
                      notification.readAt ? 'text-ink-700' : 'font-medium text-ink-900',
                    )}>
                      {notification.title}
                    </span>
                    <span className="mt-px block truncate text-caption text-ink-500">
                      {notification.body}
                    </span>
                  </span>
                  <span className="shrink-0 text-caption text-ink-500">
                    {new Date(notification.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
