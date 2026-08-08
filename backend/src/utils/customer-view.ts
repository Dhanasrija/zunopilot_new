// What a customer looks like when it leaves the server.
//
// **Why an explicit select and not `customer: true`.** Eight endpoints spread the whole
// `Customer` row, which is how the phone number reached the browser on screens nobody
// thought of as showing a phone number. A spread also means the *next* column added to
// `Customer` ships to every client automatically — so the number was only the symptom.
//
// **The list is exhaustive as of today, not minimal, and that is deliberate.** Trimming it
// to the fields the frontend currently reads would be a payload change riding along with a
// privacy change, and if one screen turned out to use `optInSource` the breakage would look
// like a masking bug. Listing every current column keeps today's responses byte-identical
// while making tomorrow's column a decision. Narrowing it is a separate, safe change later.
//
// `tenantId` is the one omission: it is already implied by the caller's session and there is
// no screen that reads it.

/** Every `Customer` column a client currently receives. Add a new one only on purpose. */
export const CUSTOMER_VIEW_SELECT = {
  id: true,
  waId: true,
  name: true,
  // WhatsApp's own name for this person, beside the agent's label. Added on purpose, per the
  // note above: the Inbox and the Customers table both render the two together, and without
  // this the client would only ever see the label.
  waProfileName: true,
  phone: true,
  lastSeenAt: true,
  lifetimeSpend: true,
  createdAt: true,
  updatedAt: true,
  marketingOptIn: true,
  optedOutAt: true,
  optInSource: true,
  tags: true,
} as const;

// **There is deliberately no `customerView()` wrapper here.**
//
// One existed briefly and was removed: it did nothing but forward to `maskContact`, and the
// name actively misled — the same call has to mask an `Order`'s `contactPhone`, which is not
// a customer at all. Call `maskContact` directly and the payload being redacted stays
// obvious at the call site.
