import { cn, initialsOf, timeAgo } from '@/lib/utils';
import { tintFor } from '@/lib/categorical-tint';
import { displayName, type Conversation, type Scope } from './types';

// The left pane: three scope pills over a list of conversations.
//
// **The selected row had no highlight before this.** `Inbox.tsx` styled it `bg-accent` and
// `hover:bg-accent`, and `accent` had no DEFAULT in `tailwind.config.js` — so both selectors
// generated no CSS at all and the open conversation looked exactly like the eight above it.
// A DEFAULT now exists, but selection here uses `surface-2` and a left marker rather than the
// accent tint: at the density of a conversation list a full accent wash on one row of many
// pulls harder than the message being read.
//
// **Selection and hover are different colours** (`surface-2` vs `surface-3`) for a reason
// worth stating: with one tint doing both jobs, moving the mouse over the row you already had
// open made it look unselected.

/** One conversation. Avatar, name, time, and one line of state. */
const Row = ({ conversation, selected, myId, onSelect }: {
  conversation: Conversation;
  selected: boolean;
  myId?: string;
  onSelect: () => void;
}) => {
  const { customer, assignedAgent, unreadCount } = conversation;
  const name = displayName(customer);
  const unread = unreadCount > 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'relative w-full border-b border-ink-200 px-3 py-3 text-left transition-colors duration-micro',
        // The marker is a pseudo-element on a `before:` utility rather than a bordered
        // container, so selecting a row cannot shift the text by a pixel.
        selected
          ? 'bg-surface-2 before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-accent-600'
          : 'hover:bg-surface-3',
      )}
    >
      <div className="flex items-start gap-3">
        {/*
          Tinted initials, from the same `tintFor` the Customers table uses — so a person is
          the same colour wherever you meet them, and the avatar becomes a weak recognition
          cue while scanning. Categorical hues only; never `success`/`danger`, which would
          imply this customer is in a good or bad state.
        */}
        <span
          aria-hidden
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-caption font-semibold',
            tintFor(customer.id),
          )}
        >
          {initialsOf(customer.name, customer.waId)}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <p className={cn(
              'min-w-0 flex-1 truncate text-sm',
              unread ? 'font-semibold text-ink-900' : 'font-medium text-ink-900',
            )}
            >
              {name}
            </p>
            {/* Relative, not absolute: in a live queue "4m" answers the question people
                actually have, and the exact stamp is on every message in the thread. */}
            <span className="shrink-0 text-caption tabular-nums text-ink-500">
              {conversation.lastMessageAt ? timeAgo(conversation.lastMessageAt) : '—'}
            </span>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-2">
            {assignedAgent ? (
              <span className={cn(
                'rounded-full px-2 py-px text-caption font-medium',
                assignedAgent.id === myId
                  ? 'bg-accent-100 text-accent-700'
                  : 'bg-surface-0 text-ink-700',
              )}
              >
                {assignedAgent.id === myId ? 'You' : assignedAgent.fullName}
              </span>
            ) : (
              <span className="rounded-full bg-warning/15 px-2 py-px text-caption font-medium text-ink-900">
                Unassigned
              </span>
            )}

            {conversation.status === 'HUMAN_TAKEOVER' && (
              <span className="rounded-full bg-danger/10 px-2 py-px text-caption font-medium text-danger">
                Human
              </span>
            )}

            {unread && (
              <span className="ml-auto min-w-6 rounded-full bg-accent-600 px-2 py-px text-center text-caption font-semibold tabular-nums text-on-accent">
                {unreadCount}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
};

export function ConversationList({
  conversations, isLoading, scope, onScopeChange, selectedId, onSelect, myId,
}: {
  conversations: Conversation[] | undefined;
  isLoading: boolean;
  scope: Scope;
  onScopeChange: (scope: Scope) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  myId?: string;
}) {
  const empty = {
    all: 'No conversations yet.',
    mine: 'Nothing assigned to you.',
    unassigned: 'Nothing waiting to be picked up.',
  }[scope];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-ink-300 px-3 py-3">
        <p className="text-sm font-semibold text-ink-900">Conversations</p>
        {/*
          One queue, three views. "Unassigned" is the shared pool an agent works from —
          without it, picking up what nobody has claimed means visually scanning the whole
          list.

          A radiogroup, not three buttons: these are one setting with three values, and
          arrow-key navigation between them is what a screen reader user expects.
        */}
        <div role="radiogroup" aria-label="Filter conversations" className="mt-2 flex gap-1">
          {([['all', 'All'], ['mine', 'Mine'], ['unassigned', 'Unassigned']] as Array<[Scope, string]>)
            .map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={scope === value}
                onClick={() => onScopeChange(value)}
                className={cn(
                  'rounded-full px-3 py-1 text-caption font-medium transition-colors duration-micro',
                  scope === value
                    ? 'bg-accent-600 text-on-accent'
                    : 'bg-surface-0 text-ink-700 hover:bg-accent-100',
                )}
              >
                {label}
              </button>
            ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && <p className="p-4 text-sm text-ink-500">Loading…</p>}
        {!isLoading && conversations?.length === 0 && (
          <p className="p-4 text-sm text-ink-500">{empty}</p>
        )}
        {conversations?.map((c) => (
          <Row
            key={c.id}
            conversation={c}
            selected={selectedId === c.id}
            myId={myId}
            onSelect={() => onSelect(c.id)}
          />
        ))}
      </div>
    </div>
  );
}
