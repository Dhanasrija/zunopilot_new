import { describe, expect, it } from 'vitest';
import { normaliseWebhook } from './webhook-intake.js';

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
  it('normalises statuses separately from messages', () => {
    const result = normaliseWebhook({
      entry: [{
        changes: [{
          value: {
            metadata: { phone_number_id: 'pn-1' },
            statuses: [{ id: 'wamid.out', status: 'delivered', recipient_id: '15550001111' }],
          },
        }],
      }],
    });
    expect(result[0]!.statuses).toEqual([
      { externalMessageId: 'wamid.out', status: 'DELIVERED', recipientId: '15550001111' },
    ]);
    expect(result[0]!.messages).toEqual([]);
  });
});
