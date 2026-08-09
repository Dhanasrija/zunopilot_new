// The id on a reply button an agent sent from the Inbox.
//
// ── Why this is its own module, for four lines of string handling ────────────
//
// Because the prefix is a **safety boundary**, and boundaries deserve somewhere to be stated once
// and tested against the thing they are protecting from.
//
// A WhatsApp reply id is an opaque string that comes straight back to us when the customer taps,
// and this system already has three independent minters of them:
//
//   • the ordering state machine, which owns `cat:`, `item:`, `qty:`, `cart:*`, `edit:`,
//     `setqty:` and `removeitem:` and dispatches on those prefixes (`services/ordering.service.ts`)
//   • workflow nodes, which accept only ids they themselves offered
//   • operator-configured BUTTON_PAYLOAD routing rules, which exact-match literals somebody typed
//     into the rules editor
//
// A fourth minter that collided with any of them would not fail loudly. It would be *answered* by
// the wrong mechanism. The worst case is not hypothetical: in `COLLECTING_NAME` and
// `COLLECTING_ADDRESS` the cart ignores the reply id entirely and takes the button's **title** as
// the customer's answer — so a tap on an agent's "Delivery" button mid-checkout would write
// `Delivery` in as the delivery address on a real order.
//
// ── Why the id is a row id, and never typed ──────────────────────────────────
//
// The id is `zp:qr:<QuickReplyButton.id>`. Three consequences, all of them the point:
//
//   1. **No human chooses it**, so no human can choose one that collides. The send API does not
//      accept an id at all.
//   2. **It is stable across sends.** The same saved button carries the same id every time, so a
//      tap on a question asked last week still resolves to the same row — no registry, no
//      expiry, no per-send bookkeeping.
//   3. **It resolves with one indexed lookup**, and a uuid is not something anybody types into a
//      routing rule by accident.

/**
 * The namespace. `zp:` leaves room for a fifth minter to live beside this one without another
 * round of collision analysis; `qr:` is this feature.
 */
export const AGENT_REPLY_PREFIX = 'zp:qr:';

/**
 * The id to put on the wire for a saved button.
 *
 * 42 characters with a uuid, comfortably inside Meta's 256-character limit for a reply id.
 */
export const quickReplyButtonId = (buttonId: string): string => `${AGENT_REPLY_PREFIX}${buttonId}`;

/**
 * The button row this reply id names, or null if it is not one of ours.
 *
 * Null for every id the ordering flow, a workflow node or an operator's rule owns — which is what
 * makes it safe to test this first and fall through to the existing routing when it says no.
 */
export const quickReplyButtonIdOf = (replyId: string | null | undefined): string | null => {
  if (!replyId || !replyId.startsWith(AGENT_REPLY_PREFIX)) return null;

  const id = replyId.slice(AGENT_REPLY_PREFIX.length);
  // A bare prefix with nothing after it is not a button. Returning `''` would turn into a
  // `findUnique({ where: { id: '' } })` — a pointless query whose miss reads like a deleted row.
  return id.length > 0 ? id : null;
};
