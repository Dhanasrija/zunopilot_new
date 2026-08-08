import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DeliveryTick } from './DeliveryTick';
import type { Message } from './types';

/*
 * One tick, two ticks, blue ticks.
 *
 * Assertions are on the accessible name, never on classes — the colours belong to the brand and
 * contrast gates, and a test that pins them just breaks on every retheme. What the name proves is
 * the thing that matters anyway: an agent, or a screen reader, can tell the four states apart.
 */

const message = (over: Partial<Message> = {}): Message => ({
  id: 'm1',
  direction: 'OUTBOUND',
  type: 'TEXT',
  body: 'On its way.',
  createdAt: '2026-08-08T09:00:00.000Z',
  ...over,
});

const tick = () => screen.queryByRole('img');

describe('the four states', () => {
  it('**names each one, so they are not four identical marks**', () => {
    const cases: Array<[Partial<Message>, RegExp]> = [
      [{ status: 'SENT' }, /^Sent$/],
      [{ status: 'DELIVERED', deliveredAt: '2026-08-08T09:00:30.000Z' }, /^Delivered \d/],
      [{ status: 'READ', readAt: '2026-08-08T09:02:00.000Z' }, /^Read \d/],
      [{ status: 'FAILED' }, /Not delivered/],
    ];

    for (const [over, expected] of cases) {
      const { unmount } = render(<DeliveryTick message={message(over)} />);
      expect(tick(), JSON.stringify(over)).toHaveAccessibleName(expected);
      unmount();
    }
  });

  it('carries the time, because "when" is half the question', () => {
    render(<DeliveryTick message={message({ status: 'READ', readAt: '2026-08-08T09:02:00.000Z' })} />);
    // Rendered in the viewer's locale, so assert the shape rather than a literal clock time.
    expect(tick()).toHaveAccessibleName(/^Read \d{1,2}:\d{2}/);
  });

  it('says so without a time when Meta sent none', () => {
    render(<DeliveryTick message={message({ status: 'DELIVERED', deliveredAt: null })} />);
    expect(tick()).toHaveAccessibleName('Delivered');
  });

  it('**leaves the reason to the bubble, and does not repeat it**', () => {
    /*
     * This assertion used to be the opposite: the reason was on the tick's accessible name,
     * because it is the difference between an agent retrying pointlessly and an agent knowing
     * the number is not on the allow-list.
     *
     * That was right about the reason mattering and wrong about where to put it. On the tick it
     * lived in `title`, which needs a hover held for about a second and **does not exist on a
     * touch screen** — so in practice nobody ever saw it. It is now text inside the bubble
     * (see `MessageBubble.test.tsx`), and leaving it here as well would make a screen reader
     * announce the whole reason twice for one message.
     */
    render(<DeliveryTick message={message({
      status: 'FAILED',
      statusError: '131030: Add recipient phone number to recipient list',
    })} />);

    expect(tick()).toHaveAccessibleName('Not delivered');
  });
});

describe('when there is nothing honest to show', () => {
  it('**renders nothing on an inbound message**', () => {
    // The customer's own client owns whether they read it; we have no claim to make.
    render(<DeliveryTick message={message({ direction: 'INBOUND', status: 'RECEIVED' })} />);
    expect(tick()).not.toBeInTheDocument();
  });

  it('**renders nothing on an inbound row that claims an outbound status**', () => {
    /*
     * The case the direction check exists for. An inbound message should never hold READ — the
     * ladder on the server excludes RECEIVED precisely so a delivery webhook cannot relabel one
     * — but if a row ever contradicts itself, the honest answer is silence rather than telling an
     * agent the customer read their own message.
     *
     * Worth its own test because the other inbound case uses RECEIVED, which the status switch
     * already refuses: removing the direction check entirely left every assertion here passing.
     */
    render(<DeliveryTick message={message({
      direction: 'INBOUND', status: 'READ', readAt: '2026-08-08T09:02:00.000Z',
    })} />);
    expect(tick()).not.toBeInTheDocument();
  });

  it('renders nothing when the status is missing', () => {
    // Rows written before this shipped. One grey tick would be a guess.
    render(<DeliveryTick message={message({ status: undefined })} />);
    expect(tick()).not.toBeInTheDocument();
  });

  it('renders nothing for RECEIVED on an outbound row', () => {
    // Should not occur — every outbound row is born SENT — but the enum permits it, and a
    // delivery claim for a message with no delivery state would be invented.
    render(<DeliveryTick message={message({ status: 'RECEIVED' })} />);
    expect(tick()).not.toBeInTheDocument();
  });
});

describe('a status that overtook another', () => {
  it('**reports READ even with no deliveredAt, and does not invent one**', () => {
    /*
     * The documented consequence of the server's monotonic guard: Meta delivers status webhooks
     * out of order, so a `delivered` arriving after a `read` is rejected and `deliveredAt` stays
     * null. Deriving the state from the timestamps instead of `status` would show two white
     * ticks for a message the customer had already read.
     */
    render(<DeliveryTick message={message({
      status: 'READ', readAt: '2026-08-08T09:02:00.000Z', deliveredAt: null,
    })} />);

    expect(tick()).toHaveAccessibleName(/^Read \d/);
    expect(tick()).not.toHaveAccessibleName(/Delivered/);
  });
});

describe('how it is announced', () => {
  it('is a labelled graphic, not a decoration', () => {
    // Unlike every other icon in this folder, this one *is* the content — so `role="img"` with a
    // name, rather than `aria-hidden`.
    render(<DeliveryTick message={message({ status: 'SENT' })} />);
    expect(tick()).toBeInTheDocument();
    expect(tick()).toHaveAttribute('title', 'Sent');
  });

  it('keeps the tooltip and the accessible name identical', () => {
    // Both come from one variable, so a reworded label cannot leave them disagreeing.
    render(<DeliveryTick message={message({ status: 'READ', readAt: '2026-08-08T09:02:00.000Z' })} />);
    expect(tick()!.getAttribute('title')).toBe(tick()!.getAttribute('aria-label'));
  });
});
