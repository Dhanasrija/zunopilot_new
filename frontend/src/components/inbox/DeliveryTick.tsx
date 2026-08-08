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
 *
 * The colours are WhatsApp's, with one correction. **#53BDEB, the famous blue tick, measures
 * 1.92:1 on WhatsApp's own green bubble** — it fails the non-text bar inside WhatsApp itself,
 * which is worth knowing before treating their palette as a reference for legibility.
 * `wa-ui-tick` is the same hue and chroma, darkened until it clears 3:1 on both bubbles.
 *
 * A failure is `danger`, not a tinted white: it is the one state an agent must not skim past.
 */

type Rendered = { icon: typeof Check; label: string; className: string };

const time = (at: string | null | undefined): string => (at
  ? new Date(at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  : '');

/** What to draw, or null when there is nothing honest to say. */
const render = (message: Message): Rendered | null => {
  switch (message.status) {
    case 'SENT':
      return { icon: Check, label: 'Sent', className: 'text-wa-ui-meta' };

    case 'DELIVERED':
      return {
        icon: CheckCheck,
        label: [`Delivered`, time(message.deliveredAt)].filter(Boolean).join(' '),
        className: 'text-wa-ui-meta',
      };

    case 'READ':
      return {
        icon: CheckCheck,
        label: [`Read`, time(message.readAt)].filter(Boolean).join(' '),
        className: 'text-wa-ui-tick',
      };

    case 'FAILED':
      return {
        icon: AlertCircle,
        /*
         * The icon says *that* it failed; `MessageBubble` says *why*, as text in the bubble.
         *
         * This label used to carry Meta's reason too, on the argument that it is the difference
         * between retrying pointlessly and knowing the number is not on the allow-list. That was
         * right about the reason mattering and wrong about where to put it: as a `title` it needed
         * a held hover, which does not exist on a touch screen. Now that the reason is real text,
         * repeating it here would make a screen reader read the whole thing twice.
         */
        label: 'Not delivered',
        className: 'text-danger',
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
