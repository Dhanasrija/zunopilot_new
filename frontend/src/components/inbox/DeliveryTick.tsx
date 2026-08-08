import { AlertCircle, Check, CheckCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Message } from './types';

/*
 * The delivery tick on an outbound message — one tick, two ticks, blue ticks.
 *
 * The state comes from `message.status` and **only the label comes from the timestamps**. Meta
 * delivers status webhooks out of order, so the server's monotonic guard rejects a `delivered`
 * that lands after a `read`: a set `readAt` beside a null `deliveredAt` is ordinary. Reading the
 * state off the timestamps instead would show two ticks for a message that has been read.
 *
 * **Shape carries the meaning before colour does**, deliberately. Sent is one tick and delivered
 * is two, so the states differ without relying on hue — which is what makes the read blue a
 * refinement rather than the only signal, and why `check-contrast.mjs` measures it against the
 * 3:1 non-text-graphic bar instead of 4.5:1.
 */

type Rendered = { icon: typeof Check; label: string; className: string };

const time = (at: string | null | undefined): string => (at
  ? new Date(at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  : '');

/** What to draw, or null when there is nothing honest to say. */
const render = (message: Message): Rendered | null => {
  switch (message.status) {
    case 'SENT':
      return { icon: Check, label: 'Sent', className: 'text-on-accent/85' };

    case 'DELIVERED':
      return {
        icon: CheckCheck,
        label: [`Delivered`, time(message.deliveredAt)].filter(Boolean).join(' '),
        className: 'text-on-accent/85',
      };

    case 'READ':
      return {
        icon: CheckCheck,
        label: [`Read`, time(message.readAt)].filter(Boolean).join(' '),
        className: 'text-wa-tick-read',
      };

    case 'FAILED':
      return {
        icon: AlertCircle,
        // Meta's own reason when it gave one — it is the difference between an agent retrying
        // pointlessly and an agent knowing the number is not on the sandbox allow-list.
        label: message.statusError ? `Not delivered — ${message.statusError}` : 'Not delivered',
        className: 'text-on-accent',
      };

    // RECEIVED is the inbound default, and an absent status is an older row. Neither has a
    // delivery state to report, and inventing one grey tick for them would be a guess.
    default:
      return null;
  }
};

export function DeliveryTick({ message }: { message: Message }) {
  // Inbound messages have no delivery state of ours to show — the customer's own client owns it.
  if (message.direction !== 'OUTBOUND') return null;

  const state = render(message);
  if (!state) return null;

  const { icon: Icon, label, className } = state;

  return (
    <span
      /*
       * `role="img"` with a label rather than `aria-hidden`, because unlike every other icon in
       * this folder this one *is* the content — the same reasoning as the flow diagram in
       * `empty-state.tsx`. `title` and `aria-label` come from one variable so a change to the
       * wording cannot leave them disagreeing.
       */
      role="img"
      aria-label={label}
      title={label}
      className={cn('shrink-0', className)}
    >
      <Icon aria-hidden className="h-3.5 w-3.5" />
    </span>
  );
}
