import type { UserRole } from '@prisma/client';

// Who may do what.
//
// One table, named by capability rather than by route. Two things follow from
// that which are worth the indirection:
//
//   • The frontend can ask for the same list and hide what a role cannot do,
//     without a second, drifting copy of the rules. A button that 403s when
//     clicked is a bug report waiting to happen.
//   • Adding a role is editing one file, not auditing every router.
//
// The middleware stays the enforcement point. This is only the data it reads —
// a permission the UI forgets to hide is still refused by the server.

export const PERMISSIONS = [
  // Inbox
  'inbox:read',
  'inbox:reply',
  'inbox:assign_self',
  /** Assign or reassign a conversation someone else owns. */
  'inbox:assign_others',
  'inbox:toggle_automation',
  'inbox:add_note',
  /*
   * Removing a message, or a whole thread, from the Inbox.
   *
   * **Not on AGENT.** It is the only inbox capability that takes something away rather than
   * adding to it, and the person who most needs to reply is not the person who should be able to
   * clear a thread. Owners hold it implicitly (`resolvePermissions` gives an owner role every
   * permission), and a workspace that wants its agents to have it can grant it in the role
   * editor — which is the shape a destructive capability should have.
   */
  'inbox:delete',

  // Customers, orders, catalogue
  'customers:read',
  'customers:write',
  /**
   * See a customer's real phone number rather than its masked form.
   *
   * Only consulted when the workspace has `maskCustomerNumbers` on — with the switch off
   * everybody sees full numbers and this key is inert. It exists so a workspace can trust
   * one manager with numbers without making them an owner.
   *
   * **Granted on the OWNER role only.** `isOwner` roles resolve to every permission, so
   * existing owners gain it the moment it exists, while existing Agent and Manager rows do
   * not — which is exactly the intent and is why no backfill is needed.
   */
  'customers:view_full_number',
  'orders:read',
  'orders:write',
  'catalogue:read',
  'catalogue:write',

  // Automation and the engine
  'workflows:read',
  'workflows:author',
  'workflows:publish',
  /** Deleting a workflow takes its history with it, so it is named separately. */
  'workflows:delete',
  'connectors:read',
  'connectors:author',
  'connectors:delete',

  // Message templates. These are Meta-approved artefacts — a bad edit is a
  // rejected template and a broken notification, so writing is named.
  'templates:write',
  'templates:delete',

  // Keyword rules and the fallback message: what the assistant says when no
  // workflow matches.
  'automation:write',

  // Workspace
  'analytics:read',
  'settings:read',
  'settings:write',
  'channel:manage',
  /**
   * Disconnecting the WhatsApp number stops every automation the business runs,
   * so it is not the same grant as refreshing a token.
   */
  'channel:disconnect',
  'team:read',
  'team:manage',
  /**
   * Create roles and decide what they may do.
   *
   * Separate from `team:manage` on purpose: adding a colleague is a daily task,
   * while changing what a whole role can reach is a change to the security model.
   * Whoever holds this can grant any permission they already hold themselves —
   * never more, or it becomes a route to privilege escalation.
   */
  'roles:manage',
  /**
   * Approve, deny or revoke a support engineer's request to view this workspace.
   *
   * OWNER only, and deliberately not folded into `settings:write`: consenting to
   * someone outside the business reading your customers' conversations is a
   * different decision from changing a setting, and should not be granted as a
   * side effect of one.
   */
  'impersonation:manage',

  // ── Optional modules ────────────────────────────────────────────────────────
  //
  // These only mean anything in a workspace an operator has given the module to
  // — `requireModule` refuses the routes with a 404 regardless of who holds the
  // permission. Two separate questions: whether the business bought it, and
  // whether this person may use it.

  // Leads
  'leads:read',
  'leads:write',
  /** Hand a lead to a colleague. Taking one off someone else is a manager's call. */
  'leads:assign',
  'leads:delete',

  // Marketing
  'campaigns:read',
  'campaigns:write',
  /**
   * Actually send a campaign.
   *
   * Separate from `campaigns:write` for the same reason `workflows:publish` is
   * separate from `workflows:author`: drafting a message and putting it in front
   * of every customer the business has are different decisions. This one also
   * spends real money — Meta bills per marketing conversation — and a campaign
   * people report or block is what degrades a number's quality rating.
   */
  'campaigns:send',

  // Customer support
  'tickets:read',
  'tickets:write',
  'tickets:assign',
  /** Closing states a promise was kept, so it is named apart from editing. */
  'tickets:close',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * What each role can do.
 *
 * The shape of the three roles, stated plainly so the table can be checked
 * against intent rather than read as a list of strings:
 *
 *   AGENT   — answers customers. The inbox, plus the customer and order edits that
 *             go with handling a conversation. Cannot change how the business is
 *             configured, and cannot take a conversation off a colleague.
 *   MANAGER — runs the operation. Everything an agent can do, plus the
 *             catalogue, orders, workflows and connectors. Can author and
 *             publish, but not change the team or the WhatsApp connection.
 *   OWNER   — everything, including the team and billing-adjacent settings.
 *
 * `publish` and `connectors:delete` sit with MANAGER deliberately: publishing
 * points a graph at real customers, but a workspace where only the owner can
 * ship is a workspace where the owner becomes the bottleneck. Deleting a
 * connector breaks every workflow that calls it, so it stays narrower.
 */
const AGENT: Permission[] = [
  'inbox:read',
  'inbox:reply',
  'inbox:assign_self',
  'inbox:add_note',
  'inbox:toggle_automation',
  'customers:read',
  // Writes an agent genuinely needs mid-conversation: correcting a customer's
  // name, and advancing an order while on the phone to them. Both were ungated
  // before permissions reached those routes, so granting them here keeps the
  // starting Agent role behaving exactly as it did — and a workspace that wants a
  // stricter role can now build one.
  'customers:write',
  'orders:read',
  'orders:write',
  'catalogue:read',
  'workflows:read',
  'connectors:read',
  'settings:read',
  'team:read',
  // Optional modules. An agent is the person who actually works a lead and
  // answers a ticket, so read and write are the starting grant for both.
  // `campaigns:read` is here because an agent fielding "what's this offer you
  // sent me?" needs to see what went out.
  'leads:read',
  'leads:write',
  'tickets:read',
  'tickets:write',
  'campaigns:read',
];

const MANAGER: Permission[] = [
  ...AGENT,
  'inbox:assign_others',
  'inbox:delete',
  'customers:write',
  'orders:write',
  'catalogue:write',
  'workflows:author',
  'workflows:publish',
  'connectors:author',
  'templates:write',
  'automation:write',
  'analytics:read',
  // Distributing work and closing it out is what running the operation means.
  'leads:assign',
  'tickets:assign',
  'tickets:close',
  'campaigns:write',
];

const OWNER: Permission[] = [
  ...MANAGER,
  // Seeing real customer numbers when the workspace has masking on. Here and not in
  // MANAGER, because the whole point of the switch is that the people running the
  // operation day to day cannot collect a contact list. A workspace that trusts a
  // particular manager grants this on a custom role.
  'customers:view_full_number',
  'workflows:delete',
  'templates:delete',
  'connectors:delete',
  'settings:write',
  'channel:manage',
  'channel:disconnect',
  'team:manage',
  'roles:manage',
  'impersonation:manage',
  'leads:delete',
  // Sending is the widest-blast-radius action in the product: it spends money on
  // the Meta account and it is what gets a number reported. It starts with the
  // owner, and a workspace that wants a manager to hold it can grant it on a
  // custom role — the same shape as `channel:disconnect`.
  'campaigns:send',
];

/**
 * The starting three roles.
 *
 * No longer the enforcement path — a workspace's own `Role` rows are, and every
 * tenant gets these three seeded as editable starting points. This table survives
 * as the **seed** for that, and as the fallback for a user whose `roleId` is
 * somehow unset. Keeping it means "what did Manager mean before anyone customised
 * it" has an answer.
 *
 * **Adding a permission here does not widen roles that already exist.** A
 * workspace's `Role.permissions` is a frozen snapshot taken when the tenant was
 * created, so a new key reaches existing owners (an `isOwner` role holds
 * everything implicitly) but not their existing Manager and Agent rows. That is
 * the safe direction — silently granting every workspace's agents a capability
 * they were never given would be the wrong kind of surprise — and it means an
 * owner grants the new module's permissions in the role editor once, deliberately.
 */
export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  AGENT: Object.freeze(AGENT),
  MANAGER: Object.freeze(MANAGER),
  OWNER: Object.freeze(OWNER),
};

export const can = (role: UserRole, permission: Permission): boolean =>
  ROLE_PERMISSIONS[role].includes(permission);

export const permissionsFor = (role: UserRole): Permission[] => [...ROLE_PERMISSIONS[role]];

/** Human labels, for the team screen. */
export const ROLE_DESCRIPTIONS: Record<UserRole, { label: string; blurb: string }> = {
  OWNER: {
    label: 'Owner',
    blurb: 'Full access, including the team, settings and the WhatsApp connection.',
  },
  MANAGER: {
    label: 'Manager',
    blurb: 'Runs the day to day: inbox, catalogue, orders, workflows and connectors.',
  },
  AGENT: {
    label: 'Agent',
    blurb: 'Answers customers in the shared inbox. Read-only elsewhere.',
  },
};


// ── The editor's view of the vocabulary ──────────────────────────────────────
//
// Grouped and described, because a role editor showing 31 raw strings is a screen
// nobody can use safely. The groups are how a person thinks about the product; the
// keys are what the routes enforce.

export interface PermissionMeta {
  key: Permission;
  label: string;
  /** Why someone would grant it, and what it lets them do that read-only does not. */
  hint?: string;
  /** Flagged in the UI: destructive, or a change to how the business runs. */
  sensitive?: boolean;
}

export const PERMISSION_GROUPS: Array<{
  group: string;
  blurb: string;
  permissions: PermissionMeta[];
}> = [
  {
    group: 'Inbox',
    blurb: 'Answering customers.',
    permissions: [
      { key: 'inbox:read', label: 'See conversations' },
      { key: 'inbox:reply', label: 'Reply to customers' },
      { key: 'inbox:assign_self', label: 'Claim a conversation' },
      {
        key: 'inbox:assign_others',
        label: 'Reassign a colleague’s conversation',
        hint: 'Without this they can claim unassigned chats but not take one off someone else.',
      },
      { key: 'inbox:add_note', label: 'Add internal notes' },
      {
        key: 'inbox:toggle_automation',
        label: 'Pause the assistant on a conversation',
        hint: 'Needed to take over from the bot and hand back.',
      },
      {
        key: 'inbox:delete',
        label: 'Remove messages from a thread',
        hint: 'Hides them here only — the customer keeps their copy, and nothing is erased from '
          + 'reports or the record of what was said.',
      },
    ],
  },
  {
    group: 'Customers and orders',
    blurb: 'The day-to-day records.',
    permissions: [
      { key: 'customers:read', label: 'See customers' },
      { key: 'customers:write', label: 'Add and edit customers' },
      {
        // Listed here so a workspace with number masking on can grant it to one trusted
        // role without promoting that person to owner. Inert while masking is off.
        key: 'customers:view_full_number',
        label: 'See full phone numbers',
        hint: 'Only matters when number masking is on in Settings. Without it, this role '
          + 'sees the last four digits of a customer\'s number.',
        // Flagged: granting it undoes the masking the workspace deliberately turned on.
        sensitive: true,
      },
      { key: 'orders:read', label: 'See orders' },
      { key: 'orders:write', label: 'Create and update orders' },
    ],
  },
  {
    group: 'Catalogue',
    blurb: 'What the assistant can sell.',
    permissions: [
      { key: 'catalogue:read', label: 'See the catalogue' },
      {
        key: 'catalogue:write',
        label: 'Edit products, categories and add-ons',
        hint: 'Prices the assistant quotes come from here.',
      },
    ],
  },
  {
    group: 'Automation',
    blurb: 'What the assistant does without a person.',
    permissions: [
      { key: 'workflows:read', label: 'See workflows' },
      { key: 'workflows:author', label: 'Build and edit workflows' },
      {
        key: 'workflows:publish',
        label: 'Publish a workflow',
        hint: 'Publishing points a graph at real customers.',
        sensitive: true,
      },
      {
        key: 'workflows:delete',
        label: 'Delete a workflow',
        hint: 'Takes its run history with it.',
        sensitive: true,
      },
      {
        key: 'automation:write',
        label: 'Edit keyword rules and the fallback reply',
        hint: 'What the assistant says when nothing else matches.',
      },
      { key: 'templates:write', label: 'Create and edit message templates' },
      { key: 'templates:delete', label: 'Delete message templates', sensitive: true },
    ],
  },
  {
    group: 'Connectors',
    blurb: 'Reaching systems outside ZunoPilot.',
    permissions: [
      { key: 'connectors:read', label: 'See connectors' },
      { key: 'connectors:author', label: 'Register connectors and operations' },
      {
        key: 'connectors:delete',
        label: 'Delete a connector',
        hint: 'Breaks every workflow that calls it.',
        sensitive: true,
      },
    ],
  },
  {
    group: 'Workspace',
    blurb: 'How the business itself is set up.',
    permissions: [
      { key: 'analytics:read', label: 'See analytics' },
      { key: 'settings:read', label: 'See settings and billing' },
      {
        key: 'settings:write',
        label: 'Change settings, plan and billing',
        hint: 'Includes buying and changing the subscription.',
        sensitive: true,
      },
      { key: 'channel:manage', label: 'Connect a WhatsApp number or refresh its token' },
      {
        key: 'channel:disconnect',
        label: 'Disconnect the WhatsApp number',
        hint: 'Stops every automation the business runs.',
        sensitive: true,
      },
    ],
  },
  {
    group: 'Leads',
    blurb: 'The pipeline, for workspaces with the Leads module.',
    permissions: [
      { key: 'leads:read', label: 'See leads' },
      { key: 'leads:write', label: 'Add and edit leads, log calls and set reminders' },
      {
        key: 'leads:assign',
        label: 'Assign a lead to someone',
        hint: 'Without this they can work their own leads but not hand one over.',
      },
      {
        key: 'leads:delete',
        label: 'Delete a lead',
        hint: 'Takes its call history and reminders with it.',
        sensitive: true,
      },
    ],
  },
  {
    group: 'Marketing',
    blurb: 'Campaigns, for workspaces with the Marketing module.',
    permissions: [
      { key: 'campaigns:read', label: 'See campaigns and their results' },
      { key: 'campaigns:write', label: 'Create and edit campaigns' },
      {
        key: 'campaigns:send',
        label: 'Send a campaign',
        hint: 'Messages every matching customer, costs money on the WhatsApp account, '
          + 'and is what puts the number’s quality rating at risk.',
        sensitive: true,
      },
    ],
  },
  {
    group: 'Customer support',
    blurb: 'Tickets, for workspaces with the Support module.',
    permissions: [
      { key: 'tickets:read', label: 'See tickets' },
      { key: 'tickets:write', label: 'Raise tickets, reply and send updates to the customer' },
      { key: 'tickets:assign', label: 'Assign a ticket to someone' },
      {
        key: 'tickets:close',
        label: 'Resolve and close tickets',
        hint: 'Closing states the customer’s problem was actually dealt with.',
      },
    ],
  },
  {
    group: 'People',
    blurb: 'Who is here and what they can reach.',
    permissions: [
      { key: 'team:read', label: 'See the team' },
      { key: 'team:manage', label: 'Add people, change their role, deactivate them', sensitive: true },
      {
        key: 'roles:manage',
        label: 'Create roles and set what they can do',
        hint: 'They can only grant permissions they already hold themselves.',
        sensitive: true,
      },
      {
        key: 'impersonation:manage',
        label: 'Allow ZunoPilot support to view this workspace',
        hint: 'Read-only, time-boxed, and always recorded.',
        sensitive: true,
      },
    ],
  },
];

/** Every permission appears in exactly one group — asserted by a test. */
export const isPermission = (value: string): value is Permission =>
  (PERMISSIONS as readonly string[]).includes(value);
