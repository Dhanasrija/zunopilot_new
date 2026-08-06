import { Badge } from '@/components/ui/badge';

// The STATUS column: whether this person may be sent marketing.
//
// **Derived, not stored.** There is no status column — the state is the pair of
// `marketingOptIn` and `optedOutAt`, and reading it in one place keeps this screen
// agreeing with `audienceWhere` in the campaign service, which decides who actually
// receives. Two definitions of "subscribed" is how a screen starts promising sends that
// never happen.

export type ContactStatus = 'subscribed' | 'pending' | 'unsubscribed';

export const statusOf = (customer: {
  marketingOptIn?: boolean;
  optedOutAt?: string | null;
}): ContactStatus => {
  // Opt-out wins over everything. Somebody who replied STOP is unreachable even though
  // `marketingOptIn` is still true — that flag records that they once agreed, and
  // overwriting it would lose the fact that they later withdrew.
  if (customer.optedOutAt) return 'unsubscribed';
  return customer.marketingOptIn ? 'subscribed' : 'pending';
};

const LABEL: Record<ContactStatus, string> = {
  subscribed: 'Subscribed',
  pending: 'Pending',
  unsubscribed: 'Unsubscribed',
};

/**
 * `destructive` for unsubscribed on purpose.
 *
 * It is the one state with a legal consequence — messaging that person is the mistake this
 * product exists to prevent — so it must not look like a milder shade of "pending".
 */
const VARIANT: Record<ContactStatus, 'default' | 'secondary' | 'destructive'> = {
  subscribed: 'default',
  pending: 'secondary',
  unsubscribed: 'destructive',
};

export const STATUS_OPTIONS: ContactStatus[] = ['subscribed', 'pending', 'unsubscribed'];
export const statusLabel = (status: ContactStatus) => LABEL[status];

export function StatusPill({ customer }: {
  customer: { marketingOptIn?: boolean; optedOutAt?: string | null };
}) {
  const status = statusOf(customer);
  return <Badge variant={VARIANT[status]}>{LABEL[status]}</Badge>;
}
