import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThreadHeader } from './ThreadHeader';
import type { Conversation, TeamMember } from './types';

// The header is where the conversation's *state* is changed, so what it must get right is who
// is allowed to change what — and, for the workflow control, saying plainly which of two very
// different things a click will do.
//
// The server enforces all of this; these tests are about not offering an action that will 403,
// and not hiding one from somebody who holds it.

const MY_ID = 'user-me';

const conversation = (over: Partial<Conversation> = {}): Conversation => ({
  id: 'c1',
  status: 'OPEN',
  automationPaused: false,
  unreadCount: 0,
  lastMessageAt: null,
  customer: { id: 'cus-1', name: 'Asha Rao', waId: '15550001111' },
  ...over,
});

const TEAM: TeamMember[] = [
  { id: MY_ID, fullName: 'Venky', role: 'OWNER', isActive: true },
  { id: 'user-priya', fullName: 'Priya Rao', role: 'AGENT', isActive: true },
  { id: 'user-gone', fullName: 'Former Colleague', role: 'AGENT', isActive: false },
];

const setup = (props: Partial<Parameters<typeof ThreadHeader>[0]> = {}) => {
  const handlers = {
    onAssign: vi.fn(),
    onHandBackToBot: vi.fn(),
    onToggleAutomation: vi.fn(),
    onRaiseTicket: vi.fn(),
  };
  render(<ThreadHeader
    conversation={conversation()}
    team={TEAM}
    myId={MY_ID}
    canAssignOthers={false}
    hasSupport
    canRaiseTicket
    handingBack={false}
    {...handlers}
    {...props}
  />);
  return handlers;
};

describe('claiming and releasing', () => {
  it('offers "Assign to me" on an unclaimed conversation', async () => {
    const { onAssign } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Assign to me' }));
    expect(onAssign).toHaveBeenCalledWith(MY_ID);
  });

  it('offers "Release" on one I already hold, and releases to nobody', async () => {
    const { onAssign } = setup({
      conversation: conversation({ assignedAgent: { id: MY_ID, fullName: 'Venky', email: 'v@x.test' } }),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Release' }));
    expect(onAssign).toHaveBeenCalledWith(null);
  });

  it('**will not let me take a colleague’s conversation without `inbox:assign_others`**', () => {
    /*
     * Claiming what is free is always allowed; taking what someone else holds is not. Two people
     * silently swapping a live customer is how they get asked the same question twice — so
     * without the permission there is no control at all, just a statement of who has it.
     */
    setup({
      canAssignOthers: false,
      conversation: conversation({
        assignedAgent: { id: 'user-priya', fullName: 'Priya Rao', email: 'p@x.test' },
      }),
    });

    expect(screen.getByText(/assigned to/i)).toBeInTheDocument();
    expect(screen.getByText('Priya Rao')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Assign to me' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Release' })).not.toBeInTheDocument();
  });

  it('gives the reassignment menu only to someone who holds the permission', () => {
    const { unmount } = render(<ThreadHeader
      conversation={conversation()} team={TEAM} myId={MY_ID}
      canAssignOthers={false} hasSupport canRaiseTicket handingBack={false}
      onAssign={vi.fn()} onHandBackToBot={vi.fn()} onToggleAutomation={vi.fn()} onRaiseTicket={vi.fn()}
    />);
    expect(screen.queryByRole('button', { name: /Unassigned/ })).not.toBeInTheDocument();
    unmount();

    setup({ canAssignOthers: true });
    expect(screen.getByRole('button', { name: /Unassigned/ })).toBeInTheDocument();
  });

  it('**lists only people who can still be assigned work**', async () => {
    // A deactivated colleague in the list is an assignment into a black hole.
    setup({ canAssignOthers: true });
    await userEvent.click(screen.getByRole('button', { name: /Unassigned/ }));

    expect(await screen.findByRole('menuitem', { name: /Priya Rao/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Former Colleague/ })).not.toBeInTheDocument();
  });

  it('assigns to the colleague chosen from the menu', async () => {
    const { onAssign } = setup({ canAssignOthers: true });
    await userEvent.click(screen.getByRole('button', { name: /Unassigned/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Priya Rao/ }));
    expect(onAssign).toHaveBeenCalledWith('user-priya');
  });
});

describe('the blocked-bot control', () => {
  const parked = conversation({
    activeWorkflowInstance: {
      id: 'wi1', status: 'PAUSED', currentNodeId: 'handoff', workflow: { name: 'Order tracking' },
    },
  });
  const running = conversation({
    activeWorkflowInstance: {
      id: 'wi2', status: 'RUNNING', currentNodeId: 'ask', workflow: { name: 'Order tracking' },
    },
  });

  it('is absent when no workflow holds the conversation', () => {
    setup();
    expect(screen.queryByRole('button', { name: /bot|flow/i })).not.toBeInTheDocument();
  });

  it('**says "Hand back to the bot" for a parked flow, which is a one-way door otherwise**', () => {
    // A handoff node parks the instance forever. Until this button existed, a conversation that
    // reached a handoff was automated exactly once and never again.
    setup({ conversation: parked });
    expect(screen.getByRole('button', { name: /Hand back to the bot/ })).toBeInTheDocument();
  });

  it('says "Cancel the running flow" instead when the flow is mid-conversation', () => {
    // Different words because it is a different act: this one abandons a customer mid-question.
    setup({ conversation: running });
    expect(screen.getByRole('button', { name: /Cancel the running flow/ })).toBeInTheDocument();
  });

  it('hands a parked flow back without asking, because nothing is being abandoned', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { onHandBackToBot } = setup({ conversation: parked });
    await userEvent.click(screen.getByRole('button', { name: /Hand back to the bot/ }));
    expect(confirm).not.toHaveBeenCalled();
    expect(onHandBackToBot).toHaveBeenCalledOnce();
  });

  it('**confirms before cancelling a flow that is still running**', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { onHandBackToBot } = setup({ conversation: running });
    await userEvent.click(screen.getByRole('button', { name: /Cancel the running flow/ }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(onHandBackToBot).toHaveBeenCalledOnce();
  });

  it('does nothing when that confirmation is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onHandBackToBot } = setup({ conversation: running });
    await userEvent.click(screen.getByRole('button', { name: /Cancel the running flow/ }));
    expect(onHandBackToBot).not.toHaveBeenCalled();
  });
});

describe('raising a ticket', () => {
  it('is offered when the workspace has Support and the agent may write tickets', () => {
    setup({ hasSupport: true, canRaiseTicket: true });
    expect(screen.getByRole('button', { name: /Raise ticket/ })).toBeInTheDocument();
  });

  it('is hidden without the module, and hidden without the permission', () => {
    // Two independent gates. Either one absent means the button must not appear — the module
    // because the routes 404, the permission because the write is refused.
    const { unmount } = render(<ThreadHeader
      conversation={conversation()} team={TEAM} myId={MY_ID} canAssignOthers={false}
      hasSupport={false} canRaiseTicket handingBack={false}
      onAssign={vi.fn()} onHandBackToBot={vi.fn()} onToggleAutomation={vi.fn()} onRaiseTicket={vi.fn()}
    />);
    expect(screen.queryByRole('button', { name: /Raise ticket/ })).not.toBeInTheDocument();
    unmount();

    setup({ hasSupport: true, canRaiseTicket: false });
    expect(screen.queryByRole('button', { name: /Raise ticket/ })).not.toBeInTheDocument();
  });
});

describe('the automation switch', () => {
  it('reads as on when automation is not paused', () => {
    setup();
    expect(screen.getByRole('switch', { name: /automation/i })).toBeChecked();
  });

  it('**sends `paused: true` when switched off** — the flag is the inverse of the control', () => {
    // The switch shows "automation on"; the API takes "paused". Getting this backwards silently
    // un-pauses a conversation an agent has taken over.
    const { onToggleAutomation } = setup();
    return userEvent.click(screen.getByRole('switch', { name: /automation/i }))
      .then(() => expect(onToggleAutomation).toHaveBeenCalledWith(true));
  });

  it('sends `paused: false` when switched back on', async () => {
    const { onToggleAutomation } = setup({ conversation: conversation({ automationPaused: true }) });
    expect(screen.getByRole('switch', { name: /automation/i })).not.toBeChecked();
    await userEvent.click(screen.getByRole('switch', { name: /automation/i }));
    expect(onToggleAutomation).toHaveBeenCalledWith(false);
  });
});

describe('the customer’s number', () => {
  it('shows it under the name, and never twice when there is no name', () => {
    const { unmount } = render(<ThreadHeader
      conversation={conversation()} team={TEAM} myId={MY_ID} canAssignOthers={false}
      hasSupport canRaiseTicket handingBack={false}
      onAssign={vi.fn()} onHandBackToBot={vi.fn()} onToggleAutomation={vi.fn()} onRaiseTicket={vi.fn()}
    />);
    expect(screen.getByText('Asha Rao')).toBeInTheDocument();
    expect(screen.getByText('15550001111')).toBeInTheDocument();
    unmount();

    // Unnamed: the number is the heading, so printing it again below is noise.
    setup({ conversation: conversation({ customer: { id: 'x', waId: '15550002222' } }) });
    expect(screen.getAllByText('15550002222')).toHaveLength(1);
  });

  it('**offers no tel: or wa.me affordance** — masking would be pointless if it did', () => {
    setup();
    expect(document.querySelector('a[href^="tel:"]')).toBeNull();
    expect(document.querySelector('a[href*="wa.me"]')).toBeNull();
  });
});
