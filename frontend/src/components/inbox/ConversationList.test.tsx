import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConversationList } from './ConversationList';
import type { Conversation } from './types';

// The queue an agent works from.
//
// Three things here are load-bearing and none of them is visual: which conversation is marked
// as open, what the row says about who owns it, and whether the scope pills are a real control
// a keyboard can operate.

const MY_ID = 'user-me';

const conversation = (over: Partial<Conversation> = {}): Conversation => ({
  id: 'c1',
  status: 'OPEN',
  automationPaused: false,
  unreadCount: 0,
  lastMessageAt: new Date().toISOString(),
  customer: { id: 'cus-1', name: 'Asha Rao', waId: '15550001111' },
  ...over,
});

const setup = (props: Partial<Parameters<typeof ConversationList>[0]> = {}) => {
  const onSelect = vi.fn();
  const onScopeChange = vi.fn();
  render(<ConversationList
    conversations={[conversation()]}
    isLoading={false}
    scope="all"
    onScopeChange={onScopeChange}
    selectedId={null}
    onSelect={onSelect}
    myId={MY_ID}
    {...props}
  />);
  return { onSelect, onScopeChange };
};

/** The row button for a named customer. */
const rowFor = (name: string) =>
  screen.getByRole('button', { name: new RegExp(name) });

describe('which conversation is open', () => {
  it('**marks the selected row, and only that row**', () => {
    /*
     * This is the bug the redesign fixed, so it is the first thing worth locking down. The old
     * markup styled the selected row `bg-accent`, and `accent` had no DEFAULT in the Tailwind
     * config — the class generated no CSS and the open conversation looked identical to every
     * other. A class name is not assertable here, so the marker is `aria-current`, which is
     * both the accessible answer and a testable one.
     */
    render(<ConversationList
      conversations={[conversation({ id: 'c1', customer: { id: 'a', name: 'Asha', waId: '1' } }),
        conversation({ id: 'c2', customer: { id: 'b', name: 'Bala', waId: '2' } })]}
      isLoading={false}
      scope="all"
      onScopeChange={vi.fn()}
      selectedId="c2"
      onSelect={vi.fn()}
      myId={MY_ID}
    />);

    expect(rowFor('Bala')).toHaveAttribute('aria-current', 'true');
    expect(rowFor('Asha')).not.toHaveAttribute('aria-current');
  });

  it('reports the conversation id when a row is clicked', async () => {
    const { onSelect } = setup();
    await userEvent.click(rowFor('Asha Rao'));
    expect(onSelect).toHaveBeenCalledWith('c1');
  });
});

describe('what a row says about ownership', () => {
  it('says "Unassigned" when nobody has claimed it', () => {
    // The shared pool. An agent scanning the list needs to see what is free to pick up.
    setup();
    expect(within(rowFor('Asha Rao')).getByText('Unassigned')).toBeInTheDocument();
  });

  it('says "You" rather than my own name when it is mine', () => {
    setup({
      conversations: [conversation({
        assignedAgent: { id: MY_ID, fullName: 'Venky', email: 'v@x.test' },
      })],
    });
    expect(within(rowFor('Asha Rao')).getByText('You')).toBeInTheDocument();
    expect(within(rowFor('Asha Rao')).queryByText('Venky')).not.toBeInTheDocument();
  });

  it('names the colleague who owns it', () => {
    setup({
      conversations: [conversation({
        assignedAgent: { id: 'user-other', fullName: 'Priya Rao', email: 'p@x.test' },
      })],
    });
    expect(within(rowFor('Asha Rao')).getByText('Priya Rao')).toBeInTheDocument();
  });

  it('flags a conversation a human has taken over', () => {
    setup({ conversations: [conversation({ status: 'HUMAN_TAKEOVER' })] });
    expect(within(rowFor('Asha Rao')).getByText('Human')).toBeInTheDocument();
  });

  it('shows an unread count, and shows nothing at zero', () => {
    const { unmount } = render(<ConversationList
      conversations={[conversation({ unreadCount: 3 })]}
      isLoading={false} scope="all" onScopeChange={vi.fn()}
      selectedId={null} onSelect={vi.fn()} myId={MY_ID}
    />);
    expect(within(rowFor('Asha Rao')).getByText('3')).toBeInTheDocument();
    unmount();

    setup({ conversations: [conversation({ unreadCount: 0 })] });
    expect(within(rowFor('Asha Rao')).queryByText('0')).not.toBeInTheDocument();
  });
});

describe('the customer’s name', () => {
  it('falls back to the number when there is no profile name', () => {
    // An inbound contact may have no name at all. The number shown here is whatever the API
    // returned, which is already masked when the workspace has masking on — this component
    // must never try to reconstruct or reformat it.
    setup({ conversations: [conversation({ customer: { id: 'x', waId: '15550002222' } })] });
    expect(screen.getByRole('button', { name: /15550002222/ })).toBeInTheDocument();
  });

  it('**renders a masked number exactly as the server sent it**', () => {
    setup({ conversations: [conversation({ customer: { id: 'x', waId: '••••••3210' } })] });
    expect(screen.getByRole('button', { name: /••••••3210/ })).toBeInTheDocument();
    // No digits were invented to fill the mask.
    expect(screen.queryByText(/15550/)).not.toBeInTheDocument();
  });
});

describe('the scope pills', () => {
  it('exposes one radiogroup with the current scope checked', () => {
    // Three values of one setting, not three unrelated buttons — so a screen reader announces
    // "1 of 3" and arrow keys work.
    setup({ scope: 'unassigned' });
    const group = screen.getByRole('radiogroup', { name: /filter conversations/i });
    expect(within(group).getByRole('radio', { name: 'Unassigned' })).toBeChecked();
    expect(within(group).getByRole('radio', { name: 'All' })).not.toBeChecked();
  });

  it('reports the chosen scope', async () => {
    const { onScopeChange } = setup();
    await userEvent.click(screen.getByRole('radio', { name: 'Mine' }));
    expect(onScopeChange).toHaveBeenCalledWith('mine');
  });
});

describe('when there is nothing to show', () => {
  it('says why the list is empty in the words of the scope selected', () => {
    // "No conversations yet." under the Unassigned filter is wrong and sends the agent looking
    // for a bug. Each scope explains its own emptiness.
    const cases = [
      ['all', 'No conversations yet.'],
      ['mine', 'Nothing assigned to you.'],
      ['unassigned', 'Nothing waiting to be picked up.'],
    ] as const;

    for (const [scope, copy] of cases) {
      const { unmount } = render(<ConversationList
        conversations={[]} isLoading={false} scope={scope}
        onScopeChange={vi.fn()} selectedId={null} onSelect={vi.fn()} myId={MY_ID}
      />);
      expect(screen.getByText(copy)).toBeInTheDocument();
      unmount();
    }
  });

  it('**does not claim the queue is empty while it is still loading**', () => {
    // The distinction matters: "Nothing waiting to be picked up" during the first fetch tells
    // an agent to stop looking.
    render(<ConversationList
      conversations={undefined} isLoading scope="unassigned"
      onScopeChange={vi.fn()} selectedId={null} onSelect={vi.fn()} myId={MY_ID}
    />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText('Nothing waiting to be picked up.')).not.toBeInTheDocument();
  });
});
