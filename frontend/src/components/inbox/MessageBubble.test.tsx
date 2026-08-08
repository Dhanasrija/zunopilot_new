import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageBubble } from './MessageBubble';
import type { Message } from './types';

// What a bubble has to get right is attribution, not appearance.
//
// A shared inbox where a colleague's reply, your own and the bot's all look identical is the
// failure this component exists to prevent: an agent cannot tell whether a customer has already
// been answered, so they answer again. That is the property under test here — not the colours,
// which the brand gate owns.

const MY_ID = 'user-me';

const message = (over: Partial<Message> = {}): Message => ({
  id: 'm1',
  direction: 'OUTBOUND',
  type: 'TEXT',
  body: 'On its way.',
  payload: null,
  createdAt: '2026-08-05T12:30:00.000Z',
  ...over,
});

describe('who sent this', () => {
  it('labels an automated reply "Bot"', () => {
    // `sentByUser: null` on an outbound message means the engine or the assistant sent it.
    render(<MessageBubble message={message({ sentByUser: null })} myId={MY_ID} />);
    expect(screen.getByText('Bot')).toBeInTheDocument();
  });

  it('labels my own reply "You" rather than my name', () => {
    render(<MessageBubble
      message={message({ sentByUser: { id: MY_ID, fullName: 'Venky', role: 'OWNER' } })}
      myId={MY_ID}
    />);
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.queryByText('Venky')).not.toBeInTheDocument();
  });

  it('**names the colleague who replied**', () => {
    // The whole point of a shared inbox. Without this the reply above looks like mine.
    render(<MessageBubble
      message={message({ sentByUser: { id: 'user-other', fullName: 'Priya Rao', role: 'AGENT' } })}
      myId={MY_ID}
    />);
    expect(screen.getByText('Priya Rao')).toBeInTheDocument();
  });

  it('puts no sender label on an inbound message', () => {
    // It came from the customer; whose name it is was never in question.
    render(<MessageBubble message={message({ direction: 'INBOUND', body: 'where is it?' })} myId={MY_ID} />);
    expect(screen.getByText('where is it?')).toBeInTheDocument();
    expect(screen.queryByText('Bot')).not.toBeInTheDocument();
    expect(screen.queryByText('You')).not.toBeInTheDocument();
  });
});

describe('the body', () => {
  it('shows the message text', () => {
    render(<MessageBubble message={message({ body: 'Two large, no onions' })} myId={MY_ID} />);
    expect(screen.getByText('Two large, no onions')).toBeInTheDocument();
  });

  it('falls back to the type when there is no text, rather than rendering an empty bubble', () => {
    // An image or a location has no body. A blank bubble reads as a bug; `[IMAGE]` reads as a
    // message this view cannot render yet, which is the truth.
    render(<MessageBubble message={message({ body: null, type: 'IMAGE' })} myId={MY_ID} />);
    expect(screen.getByText('[IMAGE]')).toBeInTheDocument();
  });
});

describe('the options an interactive message offered', () => {
  const withOptions = message({
    body: 'What would you like?',
    payload: { outbound: { options: [{ id: 'row_pizza', title: 'Pizza' }, { id: 'row_pasta', title: 'Pasta' }] } },
  });

  it('**lists the choices, so the customer’s next reply is not a row id from nowhere**', () => {
    render(<MessageBubble message={withOptions} myId={MY_ID} />);
    expect(screen.getByText('Pizza')).toBeInTheDocument();
    expect(screen.getByText('Pasta')).toBeInTheDocument();
  });

  it('carries the row id in the title attribute, for when a reply has to be traced', () => {
    render(<MessageBubble message={withOptions} myId={MY_ID} />);
    expect(screen.getByText('Pizza')).toHaveAttribute('title', 'row_pizza');
  });

  it('**ignores Meta’s own payload shapes rather than trying to interpret them**', () => {
    /*
     * `payload` carries whatever arrived from Meta as well as our own `outbound` mirror. Reading
     * it loosely is how an inbound `interactive` object gets rendered as if it were a list this
     * business offered. Each of these must produce no chips and no crash.
     */
    const hostile = [
      { interactive: { list_reply: { id: 'x', title: 'Not ours' } } },
      { outbound: { options: 'not-an-array' } },
      { outbound: { options: [{ id: 'no-title' }, null, 'string'] } },
      { outbound: null },
      null,
    ];

    for (const payload of hostile) {
      const { unmount } = render(<MessageBubble message={message({ payload })} myId={MY_ID} />);
      expect(screen.queryByText('Not ours')).not.toBeInTheDocument();
      expect(screen.getByText('On its way.')).toBeInTheDocument();
      unmount();
    }
  });
});

describe('the delivery tick', () => {
  it('**appears on an outbound message and not on an inbound one**', () => {
    // The wiring, not the tick itself — DeliveryTick.test.tsx owns the four states. What can go
    // wrong here is the component existing and never being rendered.
    const { unmount } = render(<MessageBubble message={message({ status: 'READ', readAt: '2026-08-08T09:02:00.000Z' })} myId={MY_ID} />);
    expect(screen.getByRole('img')).toHaveAccessibleName(/^Read/);
    unmount();

    render(<MessageBubble message={message({ direction: 'INBOUND', status: 'RECEIVED' })} myId={MY_ID} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('sits beside the timestamp rather than replacing it', () => {
    // Both belong on that line; an earlier layout would have been one or the other.
    render(<MessageBubble message={message({ status: 'DELIVERED', deliveredAt: '2026-08-08T09:00:30.000Z' })} myId={MY_ID} />);
    expect(screen.getByRole('img')).toHaveAccessibleName(/^Delivered/);
    // The bubble's own timestamp is still rendered.
    expect(screen.getByText(/2026|Aug/)).toBeInTheDocument();
  });
});

describe('removing a message', () => {
  const remove = () => screen.queryByRole('button', { name: /Remove from inbox/i });

  it('**is offered only to someone who may do it**', () => {
    const { unmount } = render(<MessageBubble message={message()} myId={MY_ID} />);
    expect(remove()).not.toBeInTheDocument();
    unmount();

    render(<MessageBubble message={message()} myId={MY_ID} canDelete onDelete={vi.fn()} />);
    expect(remove()).toBeInTheDocument();
  });

  it('reports the click, without confirming first', async () => {
    // One row, visibly identified. A dialog on every tidy-up trains people to click through
    // dialogs, which is what makes the one on "clear the whole thread" worth having.
    const onDelete = vi.fn();
    render(<MessageBubble message={message()} myId={MY_ID} canDelete onDelete={onDelete} />);

    await userEvent.click(remove()!);
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('is reachable by keyboard', async () => {
    /*
     * A real focus target, which is what a `<div onClick>` would quietly lose.
     *
     * There is no hover-reveal to test any more: the control is always rendered, quietly. An
     * earlier version hid it behind `group-hover`, which meant it never appeared at all on a
     * touch screen — and this Inbox goes down to 375px.
     */
    render(<MessageBubble message={message()} myId={MY_ID} canDelete onDelete={vi.fn()} />);

    await userEvent.tab();
    expect(remove()).toHaveFocus();
  });

  it('**says the customer keeps their copy**', () => {
    /*
     * The label is the only place a person learns this. WhatsApp has no unsend, so "Delete" would
     * promise something the platform cannot do — an agent would believe they had recalled a
     * message that is still sitting on somebody's phone.
     */
    render(<MessageBubble message={message()} myId={MY_ID} canDelete onDelete={vi.fn()} />);
    expect(remove()).toHaveAccessibleName(/customer keeps their copy/i);
  });

  it('is offered on an inbound message too', () => {
    // A customer can send something an agent needs out of a shared screen just as easily.
    render(<MessageBubble
      message={message({ direction: 'INBOUND' })} myId={MY_ID} canDelete onDelete={vi.fn()}
    />);
    expect(remove()).toBeInTheDocument();
  });
});
