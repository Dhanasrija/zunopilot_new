import { Bot, Check, ChevronDown, LifeBuoy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn, initialsOf } from '@/lib/utils';
import { tintFor } from '@/lib/categorical-tint';
import { displayName, type Conversation, type TeamMember } from './types';

// The thread header: who this is, who owns it, and the three controls that change the
// conversation's state.
//
// Every behaviour here came over from `Inbox.tsx` unchanged. One control did not: assignment
// was a native `<select>`, which took the browser's chrome — a grey system dropdown sitting
// among the app's own buttons. It is now the `DropdownMenu` primitive the rest of the product
// uses. Same two states, same mutation.

export function ThreadHeader({
  conversation, team, myId, canAssignOthers, hasSupport, canRaiseTicket,
  onAssign, onHandBackToBot, handingBack, onToggleAutomation, onRaiseTicket,
}: {
  conversation: Conversation;
  team: TeamMember[];
  myId?: string;
  canAssignOthers: boolean;
  hasSupport: boolean;
  canRaiseTicket: boolean;
  onAssign: (agentId: string | null) => void;
  onHandBackToBot: () => void;
  handingBack: boolean;
  onToggleAutomation: (paused: boolean) => void;
  onRaiseTicket: () => void;
}) {
  const { customer, assignedAgent, activeWorkflowInstance } = conversation;
  const name = displayName(customer);
  const parked = activeWorkflowInstance?.status === 'PAUSED';

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-ink-300 px-4 py-3">
      <span
        aria-hidden
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
          tintFor(customer.id),
        )}
      >
        {initialsOf(customer.name, customer.waId)}
      </span>

      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-ink-900">{name}</p>
        {/* Only when it is not already the heading — otherwise an unnamed customer gets
            their number printed twice. Masked upstream when masking is on. */}
        {customer.name && (
          <p className="truncate text-caption tabular-nums text-ink-500">{customer.waId}</p>
        )}
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {/*
          Claiming is always allowed; handing to someone else needs `inbox:assign_others`,
          because two people silently swapping a live customer is how they get asked the
          same question twice.
        */}
        {assignedAgent?.id === myId ? (
          <Button size="sm" variant="outline" onClick={() => onAssign(null)}>Release</Button>
        ) : !assignedAgent ? (
          <Button size="sm" variant="outline" onClick={() => onAssign(myId ?? null)}>Assign to me</Button>
        ) : !canAssignOthers && (
          <span className="text-caption text-ink-500">
            Assigned to <strong className="font-medium text-ink-700">{assignedAgent.fullName}</strong>
          </span>
        )}

        {canAssignOthers && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1">
                {assignedAgent
                  ? (assignedAgent.id === myId ? 'You' : assignedAgent.fullName)
                  : 'Unassigned'}
                <ChevronDown aria-hidden className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onAssign(null)}>
                <Check aria-hidden className={cn('mr-2 h-3.5 w-3.5', assignedAgent && 'invisible')} />
                Unassigned
              </DropdownMenuItem>
              {team.filter((m) => m.isActive).map((m) => (
                <DropdownMenuItem key={m.id} onClick={() => onAssign(m.id)}>
                  <Check
                    aria-hidden
                    className={cn('mr-2 h-3.5 w-3.5', assignedAgent?.id !== m.id && 'invisible')}
                  />
                  {m.id === myId ? 'Me' : m.fullName}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/*
          The bot is blocked. Shown only when something is actually holding the workflow
          slot, because the router refuses every inbound message while one is — and `PAUSED`
          means a handoff node parked it and nothing will ever move it on. An agent looking
          at an unanswered conversation had no way to see that, which made the handoff a
          one-way door.
        */}
        {activeWorkflowInstance && (
          <Button
            size="sm"
            variant={parked ? 'default' : 'outline'}
            className="gap-1"
            disabled={handingBack}
            title={parked
              ? `"${activeWorkflowInstance.workflow.name}" handed this conversation to a person and is waiting. The bot cannot reply until it is cleared.`
              : `"${activeWorkflowInstance.workflow.name}" is mid-conversation. Handing back cancels it, and the customer's next message starts fresh.`}
            onClick={() => {
              // A confirm only for a flow still in progress — cancelling that abandons a
              // customer mid-question, which is different from clearing one that has
              // already given up.
              if (parked || window.confirm(
                `"${activeWorkflowInstance.workflow.name}" is still running. Cancel it and let the bot start fresh on the next message?`,
              )) {
                onHandBackToBot();
              }
            }}
          >
            <Bot aria-hidden className="h-3.5 w-3.5" />
            {parked ? 'Hand back to the bot' : 'Cancel the running flow'}
          </Button>
        )}

        {/*
          Raising from here rather than from the Support screen is the point: it carries the
          `conversationId`, which is what lets the ticket be replied to on WhatsApp at all. A
          ticket raised standalone has nobody to send an update to.
        */}
        {hasSupport && canRaiseTicket && (
          <Button size="sm" variant="outline" className="gap-1" onClick={onRaiseTicket}>
            <LifeBuoy aria-hidden className="h-3.5 w-3.5" /> Raise ticket
          </Button>
        )}

        <label className="flex items-center gap-2 text-caption text-ink-700">
          Automation
          <Switch
            checked={!conversation.automationPaused}
            onCheckedChange={(v) => onToggleAutomation(!v)}
          />
        </label>
      </div>
    </div>
  );
}
