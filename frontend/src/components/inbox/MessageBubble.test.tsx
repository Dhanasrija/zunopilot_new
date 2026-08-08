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

describe('why a message did not arrive', () => {
  /*
   * **The reason has to be readable without a hover.** It was already present as the tick's
   * `title`, and that made it effectively invisible: a native tooltip needs a hover held for
   * about a second, and there is no hover on a touch screen — this Inbox goes down to 375px.
   * An agent staring at a red icon cannot tell "the 24-hour window closed" from "this number is
   * not on the allow-list", and those want opposite responses.
   */

  it('**shows Meta’s reason as text in the bubble**', () => {
    render(<MessageBubble message={message({
      status: 'FAILED',
      statusError: '131047: Message failed to send because more than 24 hours have passed',
    })} myId={MY_ID} />);

    // `getByText`, not an accessible name — the point is that it is on screen, not merely
    // reachable by a screen reader that knows to look at the icon.
    expect(screen.getByText(/more than 24 hours have passed/)).toBeInTheDocument();
  });

  it('**says a reason is missing rather than showing a bare icon**', () => {
    /*
     * Meta only attaches `errors[]` to some failures, and any message that failed before
     * delivery statuses were captured has nothing stored — Meta never replays a status webhook,
     * so those are unrecoverable. "no reason recorded" is true of both; "WhatsApp gave no
     * reason" would be inventing a fact about the past.
     */
    render(<MessageBubble message={message({ status: 'FAILED', statusError: null })} myId={MY_ID} />);
    expect(screen.getByText('Not delivered — no reason recorded')).toBeInTheDocument();
  });

  it('does not announce the reason twice', () => {
    // The tick carries *that* it failed; the text carries *why*. Both saying why would make a
    // screen reader read the whole sentence twice for one message.
    render(<MessageBubble message={message({
      status: 'FAILED', statusError: '131030: Add recipient phone number to recipient list',
    })} myId={MY_ID} />);

    expect(screen.getByRole('img')).toHaveAccessibleName('Not delivered');
    expect(screen.getByText(/Add recipient phone number/)).toBeInTheDocument();
  });

  it('stays quiet on a message that did arrive', () => {
    for (const status of ['SENT', 'DELIVERED', 'READ'] as const) {
      const { unmount } = render(<MessageBubble message={message({ status })} myId={MY_ID} />);
      expect(screen.queryByText(/Not delivered/), status).not.toBeInTheDocument();
      unmount();
    }
  });

  it('**stays quiet on an inbound row that claims FAILED**', () => {
    // We have no delivery claim to make about a message the customer sent. A row that
    // contradicts itself gets silence, not a red banner on the customer's own message.
    render(<MessageBubble message={message({
      direction: 'INBOUND', status: 'FAILED', statusError: 'should never be shown',
    })} myId={MY_ID} />);

    expect(screen.queryByText(/Not delivered/)).not.toBeInTheDocument();
    expect(screen.queryByText(/should never be shown/)).not.toBeInTheDocument();
  });
});

describe('the actions menu', () => {
  const open = async () => {
    await userEvent.click(screen.getByRole('button', { name: /Message actions/i }));
  };
  const item = (name: RegExp) => screen.queryByRole('menuitem', { name });

  it('**offers Reply and Remove, in that order**', async () => {
    // A menu rather than two icons, because the list is going to grow — React, Star, Pin,
    // Forward and Copy are all obvious next candidates, and five buttons beside every bubble
    // in a thread of five hundred is not a design.
    render(<MessageBubble
      message={message()} myId={MY_ID} canDelete onDelete={vi.fn()} onReply={vi.fn()}
    />);
    await open();

    const labels = screen.getAllByRole('menuitem').map((el) => el.textContent);
    expect(labels).toEqual(['Reply', 'Remove from inbox']);
  });

  it('**says "Remove from inbox", not "Delete"**', async () => {
    /*
     * WhatsApp has no unsend, so the customer keeps their copy — and this is a soft delete
     * besides. WhatsApp's own menu says "Delete"; a menu has room for the accurate word, and
     * promising an unsend the platform cannot do is the one thing this label must not do.
     */
    render(<MessageBubble message={message()} myId={MY_ID} canDelete onDelete={vi.fn()} />);
    await open();

    expect(item(/Remove from inbox/i)).toBeInTheDocument();
    expect(item(/^Delete$/)).not.toBeInTheDocument();
  });

  it('shows no menu at all when neither action is available', () => {
    // An empty menu is worse than an absent one.
    render(<MessageBubble message={message()} myId={MY_ID} />);
    expect(screen.queryByRole('button', { name: /Message actions/i })).not.toBeInTheDocument();
  });

  it('drops Remove for someone without the permission, keeping Reply', async () => {
    render(<MessageBubble message={message()} myId={MY_ID} onReply={vi.fn()} />);
    await open();

    expect(item(/Reply/i)).toBeInTheDocument();
    expect(item(/Remove from inbox/i)).not.toBeInTheDocument();
  });

  it('reports each action to the page', async () => {
    const onReply = vi.fn();
    const onDelete = vi.fn();
    render(<MessageBubble
      message={message()} myId={MY_ID} canDelete onDelete={onDelete} onReply={onReply}
    />);

    await open();
    await userEvent.click(item(/Reply/i)!);
    expect(onReply).toHaveBeenCalledOnce();
    expect(onDelete).not.toHaveBeenCalled();

    await open();
    await userEvent.click(item(/Remove from inbox/i)!);
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('is reachable by keyboard', async () => {
    // A real focus target, which is what a `<div onClick>` would quietly lose. There is no
    // hover-reveal to test: the trigger is always rendered, quietly — an earlier version hid it
    // behind `group-hover`, which meant it never appeared at all on a touch screen.
    render(<MessageBubble message={message()} myId={MY_ID} canDelete onDelete={vi.fn()} />);

    await userEvent.tab();
    expect(screen.getByRole('button', { name: /Message actions/i })).toHaveFocus();
  });
});

describe('a message that quotes another', () => {
  const quoting = (over: Partial<NonNullable<Message['replyTo']>> = {}) => message({
    replyTo: {
      id: 'q1', direction: 'INBOUND', type: 'TEXT', body: 'Can you share the swagger link?', ...over,
    },
  });

  it('**shows what it is replying to**', () => {
    // The whole point: a customer who sends five things and then answers the third one is
    // unreadable in a flat transcript.
    render(<MessageBubble message={quoting()} myId={MY_ID} />);
    expect(screen.getByText(/Can you share the swagger link/)).toBeInTheDocument();
  });

  it('names who is being quoted, not just the words', () => {
    const { unmount } = render(<MessageBubble message={quoting()} myId={MY_ID} />);
    expect(screen.getByText('Customer')).toBeInTheDocument();
    unmount();

    render(<MessageBubble message={quoting({ direction: 'OUTBOUND' })} myId={MY_ID} />);
    expect(screen.getByText('You')).toBeInTheDocument();
  });

  it('describes a quoted file rather than showing an empty block', () => {
    render(<MessageBubble message={quoting({ type: 'IMAGE', body: null })} myId={MY_ID} />);
    expect(screen.getByText('[image]')).toBeInTheDocument();
  });

  it('**renders no quote when the server withheld it**', () => {
    /*
     * The server nulls `replyTo` when the quoted message has been removed from the inbox, so a
     * removal cannot leak back through a reply to it. The component's job is simply to believe
     * that — no placeholder, no "message deleted" row that puts the fact back on screen.
     */
    render(<MessageBubble message={message({ replyTo: null })} myId={MY_ID} />);
    expect(screen.queryByText('Customer')).not.toBeInTheDocument();
    expect(screen.queryByText('You')).not.toBeInTheDocument();
  });
});
