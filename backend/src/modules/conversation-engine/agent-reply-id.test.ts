import { describe, expect, it } from 'vitest';
import { AGENT_REPLY_PREFIX, quickReplyButtonId, quickReplyButtonIdOf } from './agent-reply-id.js';

/*
 * The prefix that keeps an agent's buttons out of everybody else's business.
 *
 * This file is short and its important half is negative. The positive property — "what we mint, we
 * recognise" — is the easy one and would survive almost any change. The one that matters is that
 * this recogniser says **no** to every id another mechanism owns, because a false yes there does
 * not throw: it means an agent's button gets answered by the ordering flow, or the ordering flow's
 * button gets swallowed by this handler, and either way somebody's live conversation goes wrong
 * quietly.
 *
 * So the table below is the seven prefixes the ordering state machine dispatches on
 * (`services/ordering.service.ts`), and it exists to fail the day somebody shortens `zp:qr:` to
 * something shorter and more collidable.
 */

describe('minting a button id', () => {
  it('**round-trips the row id it was made from**', () => {
    const rowId = '3f8a1c22-9b0e-4d51-8a77-6c2b19e4f0d3';

    expect(quickReplyButtonIdOf(quickReplyButtonId(rowId))).toBe(rowId);
  });

  it('stays well inside the length a reply id may be', () => {
    // Meta allows 256. A uuid puts us at 42, and the margin is what lets the prefix stay readable
    // rather than being squeezed to two characters later.
    expect(quickReplyButtonId('3f8a1c22-9b0e-4d51-8a77-6c2b19e4f0d3').length).toBeLessThan(64);
  });

  it('is the same id every time, so a tap next week still resolves', () => {
    // Not a per-send token. The whole reason the button row's own id is used is that a customer
    // who scrolls back and taps an old question should still be understood.
    const rowId = 'a1b2c3d4-0000-0000-0000-000000000001';

    expect(quickReplyButtonId(rowId)).toBe(quickReplyButtonId(rowId));
  });
});

describe('what it refuses to claim', () => {
  /** Every prefix the ordering state machine dispatches on, plus the two literal cart buttons. */
  const ORDERING_IDS = [
    'cat:3f8a1c22-9b0e-4d51-8a77-6c2b19e4f0d3',
    'item:3f8a1c22-9b0e-4d51-8a77-6c2b19e4f0d3',
    'qty:2',
    'cart:checkout',
    'cart:add_more',
    'cart:edit',
    'cart:clear',
    'edit:3f8a1c22-9b0e-4d51-8a77-6c2b19e4f0d3',
    'setqty:3f8a1c22-9b0e-4d51-8a77-6c2b19e4f0d3:2',
    'removeitem:3f8a1c22-9b0e-4d51-8a77-6c2b19e4f0d3',
  ];

  it.each(ORDERING_IDS)('**leaves %s to the ordering flow**', (id) => {
    expect(quickReplyButtonIdOf(id)).toBeNull();
  });

  it('leaves an operator\'s own payload rule alone', () => {
    // `BUTTON_PAYLOAD` rules exact-match literals somebody typed. They look like this, and none of
    // them can begin with our namespace unless somebody sets out to.
    for (const id of ['CONFIRM_BOOKING', 'book_appointment', 'yes', 'MENU']) {
      expect(quickReplyButtonIdOf(id)).toBeNull();
    }
  });

  it('claims nothing when there is nothing to claim', () => {
    expect(quickReplyButtonIdOf(null)).toBeNull();
    expect(quickReplyButtonIdOf(undefined)).toBeNull();
    expect(quickReplyButtonIdOf('')).toBeNull();
  });

  it('**refuses a bare prefix rather than looking up an empty id**', () => {
    /*
     * `zp:qr:` with nothing after it is malformed, not a button. Returning the empty string would
     * send `findUnique({ where: { id: '' } })` to Postgres, and its miss would be indistinguishable
     * from a button an operator had deleted — so the handler would answer "that button is gone"
     * for something that was never a button.
     */
    expect(quickReplyButtonIdOf(AGENT_REPLY_PREFIX)).toBeNull();
  });

  it('does not match a prefix that merely starts the same way', () => {
    // Guards against a future `zp:` sibling being swallowed by this one.
    expect(quickReplyButtonIdOf('zp:workflow:abc')).toBeNull();
    expect(quickReplyButtonIdOf('zp:')).toBeNull();
  });
});
