import { describe, expect, it } from 'vitest';
import { normaliseWebhook, __statusLadder } from './webhook-intake.js';

// Regression tests for the shape of an interactive reply.
//
// The bug these pin was subtle and expensive: the engine persisted its own
// normalised `{ replyId, replyTitle, kind }` at `payload.interactive`, but the
// ordering state machine reads Meta's `interactive.list_reply.id`. A customer's
// category tap therefore looked like plain text, fell through to the LLM router,
// which classified it as "wants to order" and re-sent the menu — an infinite
// menu loop, on a live WhatsApp number.
//
// Two things have to stay true: our normalised form must extract the reply id,
// and Meta's original object must survive in `raw` so the FSM can still read it.

const envelope = (message: Record<string, unknown>) => ({
  object: 'whatsapp_business_account',
  entry: [{
    id: 'waba',
    changes: [{
      field: 'messages',
      value: {
        metadata: { phone_number_id: 'pn-1' },
        contacts: [{ wa_id: '15550001111', profile: { name: 'Test' } }],
        messages: [{ from: '15550001111', id: 'wamid.1', timestamp: '1', ...message }],
      },
    }],
  }],
});

const first = (body: Record<string, unknown>) => normaliseWebhook(body)[0]!.messages[0]!;

describe('list replies', () => {
  const listTap = {
    type: 'interactive',
    interactive: {
      type: 'list_reply',
      list_reply: { id: 'cat:abc123', title: 'Mains', description: 'Rice dishes' },
    },
  };

  it('extracts the reply id our code uses', () => {
    const message = first(envelope(listTap));
    expect(message.interactive).toEqual({
      replyId: 'cat:abc123',
      replyTitle: 'Mains',
      kind: 'list',
    });
  });

  it("keeps Meta's own object in raw, which is what the ordering FSM reads", () => {
    // The FSM does `interactive?.list_reply?.id`. If that path stops resolving,
    // every menu tap becomes unrecognised text.
    const raw = first(envelope(listTap)).raw as Record<string, any>;
    expect(raw.interactive.list_reply.id).toBe('cat:abc123');
  });

  it('uses the row title as the message body, so the inbox is readable', () => {
    expect(first(envelope(listTap)).text).toBe('Mains');
  });
});

describe('button replies', () => {
  it('extracts an interactive button reply', () => {
    const message = first(envelope({
      type: 'interactive',
      interactive: { type: 'button_reply', button_reply: { id: 'qty:2', title: '2' } },
    }));
    expect(message.interactive).toEqual({ replyId: 'qty:2', replyTitle: '2', kind: 'button' });
  });

  it('extracts a TEMPLATE quick reply, which arrives in a different shape', () => {
    // Meta sends template buttons as `type: 'button'` with `button.payload` and
    // no `interactive` object at all. Missing this is why template buttons
    // silently did nothing.
    const message = first(envelope({
      type: 'button',
      button: { payload: 'CONFIRM_BOOKING', text: 'Confirm' },
    }));
    expect(message.interactive).toEqual({
      replyId: 'CONFIRM_BOOKING',
      replyTitle: 'Confirm',
      kind: 'button',
    });
  });
});

describe('other message types', () => {
  it('reads plain text', () => {
    const message = first(envelope({ type: 'text', text: { body: 'I want to order' } }));
    expect(message.text).toBe('I want to order');
    expect(message.interactive).toBeNull();
  });

  it('keeps a location pin as coordinates plus a readable label', () => {
    const message = first(envelope({
      type: 'location',
      location: { latitude: 17.38, longitude: 78.48, name: 'Swanlake', address: 'Tower 1' },
    }));
    expect(message.location).toEqual({
      latitude: 17.38,
      longitude: 78.48,
      label: 'Swanlake, Tower 1',
    });
    // Not "17.38,78.48" — a delivery address of raw coordinates is unreadable
    // in the inbox and on the order.
    expect(message.text).toBe('Swanlake, Tower 1');
  });

  it('does not invent text for media it cannot read', () => {
    const message = first(envelope({ type: 'image', image: { id: 'media-1' } }));
    expect(message.text).toBe('');
  });
});

describe('delivery status updates', () => {
  /** Normalise one status payload and hand back the single result. */
  const statusOf = (status: Record<string, unknown>) => normaliseWebhook({
    entry: [{
      changes: [{
        value: { metadata: { phone_number_id: 'pn-1' }, statuses: [status] },
      }],
    }],
  })[0]!.statuses[0]!;

  it('normalises statuses separately from messages', () => {
    const result = normaliseWebhook({
      entry: [{
        changes: [{
          value: {
            metadata: { phone_number_id: 'pn-1' },
            statuses: [{
              id: 'wamid.out', status: 'delivered', recipient_id: '15550001111',
              timestamp: '1785000000',
            }],
          },
        }],
      }],
    });
    expect(result[0]!.statuses).toEqual([{
      externalMessageId: 'wamid.out',
      // **Meta's own lowercase word, not an enum.** This used to be uppercased here, which made
      // the parse output resemble a `MessageStatus` while still being an arbitrary string — and
      // that resemblance is what made `status as never` at the write site look reasonable.
      status: 'delivered',
      recipientId: '15550001111',
      occurredAt: new Date(1785000000 * 1000),
      error: null,
    }]);
    expect(result[0]!.messages).toEqual([]);
  });

  describe('the reason a message failed', () => {
    it('**keeps the sentence that says what to do about it**', () => {
      // `error_data.details` over `title`, because only one of them is actionable.
      const status = statusOf({
        id: 'w1', status: 'failed', recipient_id: '1', timestamp: '1785000000',
        errors: [{
          code: 131030,
          title: 'Recipient is not in allowed list',
          message: 'Recipient phone number not in allowed list',
          error_data: { details: 'Add recipient phone number to recipient list' },
        }],
      });
      expect(status.error).toBe('131030: Add recipient phone number to recipient list');
    });

    it('falls back to message, then title', () => {
      expect(statusOf({
        id: 'w1', status: 'failed', errors: [{ code: 1, message: 'Something broke' }],
      }).error).toBe('1: Something broke');

      expect(statusOf({
        id: 'w1', status: 'failed', errors: [{ code: 2, title: 'Only a title' }],
      }).error).toBe('2: Only a title');
    });

    it('**scrubs a phone number out of it**', () => {
      /*
       * This text is returned to every agent by GET /inbox/conversations/:id/messages. A number
       * smuggled in on someone else's error string must not undo the masking the rest of the
       * codebase maintains — so it goes through the same `withoutNumbers` as meta-error.ts.
       */
      const status = statusOf({
        id: 'w1', status: 'failed',
        errors: [{ code: 131030, error_data: { details: 'Add +91 77020 00350 to the list' } }],
      });
      expect(status.error).not.toContain('77020');
      expect(status.error).toContain('131030');
    });

    it('is null when nothing failed', () => {
      expect(statusOf({ id: 'w1', status: 'read', recipient_id: '1' }).error).toBeNull();
    });
  });

  describe("Meta's timestamp", () => {
    it('is used rather than our own clock', () => {
      // A webhook retried an hour later must not claim the customer read it an hour late.
      expect(statusOf({ id: 'w1', status: 'read', timestamp: '1785000000' }).occurredAt)
        .toEqual(new Date(1785000000 * 1000));
    });

    it('**is refused when it could not be a timestamp**', () => {
      // The alternative is a tick whose tooltip reads "Read 1970".
      for (const timestamp of [undefined, null, '', 'abc', '0', '-1', '99999999999999']) {
        expect(statusOf({ id: 'w1', status: 'read', timestamp }).occurredAt, String(timestamp))
          .toBeNull();
      }
    });
  });

  describe('the ladder', () => {
    const { LADDER, advanceFrom, STATUS_BY_META } = __statusLadder;

    it('**does not contain RECEIVED**', () => {
      /*
       * The load-bearing absence. Every row a status webhook may advance *from* has to appear in
       * this array, so leaving RECEIVED out is what makes it impossible for a delivery status to
       * relabel an inbound message — a property of the data rather than an `if` to forget.
       */
      expect(LADDER).not.toContain('RECEIVED');
      expect([...LADDER]).toEqual(['SENT', 'DELIVERED', 'READ', 'FAILED']);
    });

    it('lets a status climb only from below it', () => {
      expect(advanceFrom(LADDER, 'DELIVERED')).toEqual(['SENT']);
      expect(advanceFrom(LADDER, 'READ')).toEqual(['SENT', 'DELIVERED']);
    });

    it('**puts FAILED beyond reach of a late delivered**', () => {
      // FAILED is last, so nothing outranks it: a message Meta refused stays refused.
      expect(advanceFrom(LADDER, 'FAILED')).toEqual(['SENT', 'DELIVERED', 'READ']);
      expect(advanceFrom(LADDER, 'DELIVERED')).not.toContain('FAILED');
      expect(advanceFrom(LADDER, 'READ')).not.toContain('FAILED');
    });

    it('has nothing for SENT to climb from', () => {
      // Every outbound row is born SENT, so Meta's `sent` only confirms what we recorded.
      expect(advanceFrom(LADDER, 'SENT')).toEqual([]);
    });

    it('maps only the four words Meta actually sends', () => {
      expect(Object.keys(STATUS_BY_META).sort()).toEqual(['delivered', 'failed', 'read', 'sent']);
      // The one that used to throw and cost the rest of the batch.
      expect(STATUS_BY_META.deleted).toBeUndefined();
    });
  });
});
