/*
 * The API, as the mobile team needs to see it.
 *
 * **This file is the source of truth; `openapi.json` at the repo root of the backend is
 * generated from it** by `npm run openapi`. Authoring in TypeScript rather than hand-editing
 * YAML buys two things: the object is type-checked as it is written, and one test can compare
 * the committed artifact against this module, so the two cannot drift apart silently.
 *
 * **Scope is deliberate.** The API has 222 routes. This documents the ~74 a phone actually
 * calls — signing in, the inbox, customers, orders, notifications, tickets, leads and the
 * catalogue. Super admin, billing, workflows, connectors and the engine are not here; they are
 * an operator's surface, and a spec nobody reads is worse than an honest gap. `MOBILE_SURFACE`
 * below names the prefixes that are in scope, and `openapi.drift.test.ts` fails the build if a
 * route appears under one of them without an entry here.
 *
 * **It is not served.** There is no `/docs` endpoint. Publishing a complete map of every route,
 * parameter and permission on a private product API is a gift to whoever is scanning it, and
 * the logs already show somebody walking `/api/.env`, `/config/.env` and a dozen others. The
 * mobile team import the JSON into Postman or a generator instead.
 */

/**
 * The route prefixes this document is responsible for.
 *
 * Adding a router here is a decision to document it. The drift test reads this list, so a new
 * endpoint under one of these prefixes fails until it is written up.
 */
export const MOBILE_SURFACE = [
  '/api/auth',
  '/api/tenant',
  '/api/inbox',
  '/api/conversations',
  '/api/customers',
  '/api/orders',
  '/api/catalogue',
  '/api/media',
  '/api/notifications',
  '/api/quick-replies',
  '/api/tickets',
  '/api/leads',
] as const;

/** `{ success: true, data: … }` — every successful response in this API. */
const ok = (description: string, schema: unknown) => ({
  description,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: { success: { type: 'boolean', example: true }, data: schema },
        required: ['success', 'data'],
      },
    },
  },
});

/** A list plus its `meta`, for the two endpoints that page. */
const okPaged = (description: string, item: unknown) => ({
  description,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: { type: 'array', items: item },
          meta: { $ref: '#/components/schemas/PageMeta' },
        },
        required: ['success', 'data'],
      },
    },
  },
});

/**
 * A list plus its delta cursor, for the two Inbox reads a client follows incrementally.
 *
 * Separate from `okPaged` because the two `meta` shapes answer different questions: one is "where
 * am I in a list", the other is "what have I already seen". Sharing one schema would leave every client
 * guessing which fields are populated.
 */
const okDelta = (description: string, item: unknown) => ({
  description,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: { type: 'array', items: item },
          meta: { $ref: '#/components/schemas/DeltaMeta' },
        },
        required: ['success', 'data', 'meta'],
      },
    },
  },
});

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const arrayOf = (name: string) => ({ type: 'array', items: ref(name) });

const pathParam = (name: string, description: string) => ({
  name, in: 'path', required: true, description, schema: { type: 'string', format: 'uuid' },
});

const jsonBody = (schema: unknown, required = true) => ({
  required,
  content: { 'application/json': { schema } },
});

/** The shared failure responses. Referenced rather than repeated on 74 operations. */
const errors = {
  400: { $ref: '#/components/responses/BadRequest' },
  401: { $ref: '#/components/responses/Unauthorised' },
  403: { $ref: '#/components/responses/Forbidden' },
  404: { $ref: '#/components/responses/NotFound' },
};

const auth = [{ bearerAuth: [] }];

export const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'ZunoPilot API — mobile surface',
    version: '1.0.0',
    description: [
      'The endpoints a ZunoPilot mobile client calls.',
      '',
      '### Authenticating',
      'Sign in with a phone number and a one-time code: `POST /auth/otp` sends it,',
      '`POST /auth/otp/verify` exchanges it for a JWT. Send that token as',
      '`Authorization: Bearer <token>` on every other request. There are no passwords.',
      '',
      '**The token currently lasts 24 hours and there is no refresh endpoint.** A mobile',
      'client will therefore be signed out daily until one is added — worth planning around.',
      '',
      '### Shape of a response',
      'Success is always `{ "success": true, "data": … }`. Failure is always',
      '`{ "success": false, "message": "…" }`, with the message written for a person to read.',
      '',
      '### Statuses worth knowing',
      '- **401** — no token, or an expired one. Sign in again.',
      '- **403** — signed in, but this seat lacks the permission the route needs.',
      '- **404** — either the thing does not exist, **or** the workspace does not have the',
      '  module that owns it. The two are deliberately indistinguishable, so a workspace',
      '  cannot probe for features it was never sold.',
      '- **422** — WhatsApp refused something, and `message` carries their own words.',
      '',
      '### Media',
      '**`mediaUrl` on a message is a relative API path, not a public link.** It reads',
      '`/api/media/<id>/file`, and fetching it needs the same `Authorization` header as',
      'everything else — an image widget pointed straight at it with no header gets a 401. Both',
      'directions use that one path: a photograph the customer sent, and a file the business sent',
      'back.',
      '',
      'Sending a file is two calls, never one. `POST /media` with `multipart/form-data` returns an',
      'id; `POST /inbox/conversations/{id}/media` sends that id. Uploading and sending are separate',
      'because the same upload can be sent more than once and reused as a campaign header.',
      '',
      'Ask `GET /media/rules` for what may be uploaded rather than hardcoding it — the limits are',
      "WhatsApp's and they change.",
      '',
      '### Push notifications',
      'Two transports, and a client uses exactly one of them.',
      '',
      '- **A native app** registers with `POST /notifications/push/devices`, sending its FCM',
      '  registration token and a `deviceId` it generates once and keeps. Re-send on every',
      '  token refresh — the `deviceId` is what makes that an update rather than a duplicate.',
      '  iOS is delivered through FCM as well, so there is one call for both platforms.',
      '- **A browser** uses `POST /notifications/push/subscribe` with a VAPID subscription.',
      '',
      '`GET /notifications/preferences` reports which of the two this server can actually do,',
      'as `push.available` (browser) and `push.mobileAvailable` (app). Every device a person',
      'has registered is sent to, so being signed in on two phones means both of them buzz.',
      '',
      'A push payload carries `tenantId`. Switch to that workspace before following `link` —',
      '`link` is a relative path with no workspace in it, so following it while the app is',
      'showing a different workspace opens the wrong inbox.',
    ].join('\n'),
  },
  servers: [
    { url: 'https://api.zunopilot.com/api', description: 'Production' },
    { url: 'http://localhost:4000/api', description: 'Local development' },
  ],
  security: auth,
  tags: [
    { name: 'Auth', description: 'Signing in, the session, and the profile' },
    { name: 'Workspace', description: 'The business this user belongs to' },
    { name: 'Inbox', description: 'Conversations and messages' },
    { name: 'Customers', description: 'The people who have messaged the business' },
    { name: 'Orders', description: 'Requires the ECOMMERCE module' },
    { name: 'Catalogue', description: 'Products or menu items. Requires the ECOMMERCE module' },
    { name: 'Media', description: 'Files, in both directions' },
    { name: 'Notifications', description: 'The bell, its unread count, and delivery preferences' },
    { name: 'Quick replies', description: 'Saved questions with tappable answers' },
    { name: 'Support', description: 'Tickets. Requires the SUPPORT module' },
    { name: 'Leads', description: 'The sales pipeline. Requires the LEADS module' },
  ],

  paths: {
    // ── Auth ──────────────────────────────────────────────────────────────────
    '/auth/otp': {
      post: {
        tags: ['Auth'], security: [], summary: 'Send a one-time login code',
        description:
          'Rate limited per IP. `devCode` is returned **only outside production**, so a test'
          + ' run does not spend a real SMS.',
        requestBody: jsonBody({
          type: 'object',
          properties: { phone: { type: 'string', example: '+91 77020 00350' } },
          required: ['phone'],
        }),
        responses: {
          200: ok('The code is on its way', {
            type: 'object',
            properties: {
              expiresAt: { type: 'string', format: 'date-time' },
              resendAfterSeconds: { type: 'integer', example: 30 },
              channel: { type: 'string', example: 'SMS' },
              devCode: { type: 'string', description: 'Non-production only' },
            },
          }),
          400: errors[400], 429: { $ref: '#/components/responses/TooManyRequests' },
        },
      },
    },
    '/auth/otp/verify': {
      post: {
        tags: ['Auth'], security: [], summary: 'Exchange the code for a token',
        description:
          'Signing in and signing up are one flow: a phone number that has no account gets one,'
          + ' and `isNew` says which happened. A wrong code burns an attempt; too many burn the'
          + ' challenge entirely.',
        requestBody: jsonBody({
          type: 'object',
          properties: { phone: { type: 'string' }, code: { type: 'string', example: '123456' } },
          required: ['phone', 'code'],
        }),
        responses: {
          200: ok('Signed in', {
            allOf: [
              ref('Session'),
              {
                type: 'object',
                properties: {
                  token: { type: 'string', description: 'Send as `Authorization: Bearer …`' },
                  isNew: { type: 'boolean', description: 'True when this call created the account' },
                },
              },
            ],
          }),
          400: errors[400], 429: { $ref: '#/components/responses/TooManyRequests' },
        },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Auth'], security: auth, summary: 'The current session',
        description:
          'Call this on launch. `permissions` and `modules` are what the UI hides things on —'
          + ' they are a convenience, never the enforcement, which happens per request.',
        responses: { 200: ok('The session', ref('Session')), 401: errors[401] },
      },
    },
    '/auth/workspaces': {
      get: {
        tags: ['Auth'], security: auth, summary: 'Workspaces this login can reach',
        description:
          'Answers **even when the current workspace is suspended**, and even when the token'
          + ' predates workspace scoping — it needs only a valid session, not a resolved'
          + ' workspace. That is deliberate: behind the ordinary guard, somebody whose workspace'
          + ' was suspended would have no way to reach the one that is fine.',
        responses: {
          200: ok('The list', {
            type: 'object',
            properties: { workspaces: { type: 'array', items: ref('Workspace') } },
          }),
          401: errors[401],
        },
      },
    },
    '/auth/workspaces/switch': {
      post: {
        tags: ['Auth'], security: auth, summary: 'Change which workspace this session acts in',
        description:
          'Returns a **new token** plus the full session for that workspace — swap the stored token'
          + ' for it. The new token inherits the old one’s expiry rather than starting a fresh'
          + ' lifetime, so switching cannot be used to renew a session indefinitely.\n\n'
          + 'A workspace you are not a member of answers **404, not 403**, so this cannot be used'
          + ' to discover which workspace ids exist. A support-access session is refused outright.',
        requestBody: jsonBody({
          type: 'object',
          required: ['tenantId'],
          properties: { tenantId: { type: 'string', format: 'uuid' } },
        }),
        responses: {
          200: ok('A session for that workspace', {
            allOf: [
              { type: 'object', properties: { token: { type: 'string' } } },
              ref('Session'),
            ],
          }),
          401: errors[401],
          403: errors[403],
          404: errors[404],
        },
      },
    },
    '/auth/workspaces/{tenantId}': {
      delete: {
        tags: ['Auth'], security: auth, summary: 'Leave a workspace',
        description:
          'The exit that has to exist because an invite needs no acceptance: somebody can be added'
          + ' to a workspace they have never heard of, so the door must open from the inside too.\n\n'
          + 'Refused when it would leave the workspace with nobody able to manage the team, and'
          + ' refused when it is the only workspace this login can reach — a login with no'
          + ' workspaces cannot sign in anywhere, which is account closure rather than leaving.\n\n'
          + '**No new token is issued.** The one you hold may still name the workspace just left,'
          + ' and that is safe: it now resolves to no active membership and is refused. Use the'
          + ' returned list to switch.',
        parameters: [
          {
            name: 'tenantId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          200: ok('The workspaces that remain', {
            type: 'object',
            properties: { workspaces: { type: 'array', items: ref('Workspace') } },
          }),
          400: errors[400],
          401: errors[401],
          403: errors[403],
          404: errors[404],
        },
      },
    },
    '/auth/profile': {
      put: {
        tags: ['Auth'], security: auth, summary: 'Finish onboarding',
        description:
          'Called when `tenant.onboardingCompleted` is false. Creates the workspace profile.',
        requestBody: jsonBody({
          type: 'object',
          properties: {
            fullName: { type: 'string' },
            businessName: { type: 'string' },
            businessCategoryId: { type: 'string', format: 'uuid' },
            email: { type: 'string', format: 'email' },
          },
        }),
        responses: { 200: ok('The updated session', ref('Session')), 400: errors[400], 401: errors[401] },
      },
    },
    '/auth/business-categories': {
      get: {
        tags: ['Auth'], security: [], summary: 'The categories a workspace can pick from',
        description: 'For the onboarding form. Public, because it is needed before sign-in completes.',
        responses: {
          200: ok('Categories', {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                key: { type: 'string', example: 'RESTAURANT' },
                label: { type: 'string', example: 'Restaurant' },
              },
            },
          }),
        },
      },
    },
    '/auth/verify-email': {
      post: {
        tags: ['Auth'], security: [], summary: 'Confirm an email address',
        description: 'Kept so an older verification link still works. Email is optional now.',
        requestBody: jsonBody({ type: 'object', properties: { token: { type: 'string' } }, required: ['token'] }),
        responses: { 200: ok('Verified', { type: 'object' }), 400: errors[400] },
      },
    },

    // ── Workspace ─────────────────────────────────────────────────────────────
    '/tenant/me': {
      get: {
        tags: ['Workspace'], security: auth, summary: 'The workspace profile',
        responses: { 200: ok('The workspace', ref('Tenant')), 401: errors[401] },
      },
      patch: {
        tags: ['Workspace'], security: auth, summary: 'Update the workspace profile',
        description: 'Needs `settings:write`. Also carries the AI-agent and number-masking toggles.',
        requestBody: jsonBody({ $ref: '#/components/schemas/TenantUpdate' }),
        responses: { 200: ok('The updated workspace', ref('Tenant')), ...errors },
      },
    },
    '/tenant/staff': {
      get: {
        tags: ['Workspace'], security: auth, summary: 'People who can be assigned work',
        responses: { 200: ok('Staff', arrayOf('StaffMember')), ...errors },
      },
    },

    // ── Inbox ─────────────────────────────────────────────────────────────────
    '/inbox/conversations': {
      get: {
        tags: ['Inbox'], security: auth, summary: 'List conversations',
        description: 'Needs `inbox:read`. Newest activity first.',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['OPEN', 'HUMAN_TAKEOVER', 'CLOSED'] } },
          { name: 'assignedToMe', in: 'query', schema: { type: 'boolean' } },
          {
            name: 'since',
            in: 'query',
            schema: { type: 'string', format: 'date-time' },
            description: [
          'A cursor for asking **what changed** instead of re-reading the list. Send the `nextSince`',
          'and `nextSinceId` from the previous response; the reply contains only rows modified since,',
          'and `meta.hasMore` says whether to ask again straight away rather than waiting for the next',
          'tick. Omit both for the current state. **A filter plus a cursor has one gap**: a',
          'conversation that changes out of the filtered set is not in the delta, so poll the',
          'unfiltered list and filter locally if you need it to be exact.',
        ].join(' '),
          },
          {
            name: 'sinceId',
            in: 'query',
            schema: { type: 'string' },
            description:
              'The other half of the cursor. Breaks ties between rows sharing one `since`, which'
              + ' happens whenever a bulk update stamps many rows at the same instant.',
          },
        ],
        responses: { 200: okDelta('Conversations', ref('Conversation')), ...errors },
      },
      post: {
        tags: ['Inbox'], security: auth, summary: 'Open a conversation with a customer',
        description: 'Returns the existing open one if there is one, rather than a duplicate.',
        requestBody: jsonBody({
          type: 'object',
          properties: { customerId: { type: 'string', format: 'uuid' } },
          required: ['customerId'],
        }),
        responses: { 200: ok('The conversation', ref('Conversation')), ...errors },
      },
    },
    '/inbox/conversations/{id}': {
      get: {
        tags: ['Inbox'], security: auth, summary: 'One conversation',
        parameters: [pathParam('id', 'Conversation id')],
        responses: { 200: ok('The conversation', ref('Conversation')), ...errors },
      },
    },
    '/inbox/conversations/{id}/messages': {
      delete: {
        tags: ['Inbox'], security: auth, summary: 'Clear a thread',
        description:
          'Needs `inbox:delete`. Soft-removes every message in the conversation. **Messages'
          + ' only** — the conversation, the customer, their orders, the internal notes and any'
          + ' linked ticket all survive, and the thread stays in the list reading as empty.'
          + ' `lastMessageAt` is left alone, so the queue order does not move.',
        parameters: [pathParam('id', 'Conversation id')],
        responses: {
          200: ok('Cleared', {
            type: 'object',
            properties: { removed: { type: 'integer', description: 'How many were removed.' } },
          }),
          ...errors,
        },
      },
      get: {
        tags: ['Inbox'], security: auth, summary: 'The messages in a conversation',
        description: [
          'Without `since`, the thread as it stands, oldest first, with removed messages left out.',
          '',
          'With `since` and `sinceId`, **only what changed** — ordered by when it changed, and',
          'including delivery-status updates to messages you already have. This is how a client',
          'follows the ticks without re-reading the thread: status arrives as a change to an existing',
          'row, not as a new one.',
          '',
          'A delta also reports **removals**. A message an agent deleted comes back as a tombstone —',
          '`id`, `conversationId`, `direction`, the timestamps and `deletedAt`, with no content. Drop',
          'it from the thread when you see one.',
          '',
          'Echo `meta.nextSince` and `meta.nextSinceId` back on the next call, and call again',
          'immediately while `meta.hasMore` is true.',
        ].join('\n'),
        parameters: [
          pathParam('id', 'Conversation id'),
          {
            name: 'since',
            in: 'query',
            schema: { type: 'string', format: 'date-time' },
            description: 'From `meta.nextSince`. An unparseable value is a 400, not a full read.',
          },
          { name: 'sinceId', in: 'query', schema: { type: 'string' }, description: 'From `meta.nextSinceId`.' },
        ],
        responses: { 200: okDelta('Messages, oldest first', ref('Message')), ...errors },
      },
      post: {
        tags: ['Inbox'], security: auth, summary: 'Reply as a human',
        description:
          'Needs `inbox:reply`. **422 means WhatsApp refused it** and `message` carries Meta\'s'
          + ' own words — an expired 24-hour window, a number not on a sandbox allow-list, and'
          + ' so on. 424 means the workspace\'s WhatsApp token has expired and must be'
          + ' reconnected.',
        parameters: [pathParam('id', 'Conversation id')],
        requestBody: jsonBody({
          type: 'object',
          properties: {
            body: { type: 'string' },
            replyToId: {
              type: 'string', format: 'uuid', nullable: true,
              description:
                'Quote a specific message. Must be a visible message in **this** conversation —'
                + ' anything else is a 400 rather than a silent unquoted send. Sends Meta'
                + ' `context.message_id` so WhatsApp draws the quote on the customer’s phone.',
            },
          },
          required: ['body'],
        }),
        responses: {
          201: ok('The message that was sent', ref('Message')),
          422: { $ref: '#/components/responses/WhatsappRefused' },
          424: { $ref: '#/components/responses/WhatsappDisconnected' },
          ...errors,
        },
      },
    },
    '/inbox/conversations/{id}/media': {
      post: {
        tags: ['Inbox'], security: auth, summary: 'Send a customer a file',
        description:
          'Needs `inbox:reply`. Upload the file first with `POST /media`, then send its id'
          + ' here. **Only within 24 hours of the customer\'s last message** — outside that'
          + ' window WhatsApp accepts templates only, and this returns 400 saying so. A file'
          + ' a customer sent you cannot be forwarded back; upload your own copy.',
        parameters: [pathParam('id', 'Conversation id')],
        requestBody: jsonBody({
          type: 'object',
          properties: {
            mediaId: { type: 'string', format: 'uuid', description: 'From `POST /media`' },
            caption: { type: 'string', maxLength: 1024, nullable: true },
          },
          required: ['mediaId'],
        }),
        responses: {
          201: ok('The message that was sent', ref('Message')),
          422: { $ref: '#/components/responses/WhatsappRefused' },
          424: { $ref: '#/components/responses/WhatsappDisconnected' },
          ...errors,
        },
      },
    },
    '/inbox/messages/{id}': {
      delete: {
        tags: ['Inbox'], security: auth, summary: 'Remove a message from the inbox',
        description:
          'Needs `inbox:delete`. **A soft delete, and not an unsend.** The row survives with'
          + ' `deletedAt` set, so reports and the record of what was said are unaffected — and'
          + ' WhatsApp has no unsend, so the customer keeps their copy regardless. Idempotent:'
          + ' removing an already-removed message answers 404 and keeps the original remover.',
        parameters: [pathParam('id', 'Message id')],
        responses: {
          200: ok('Removed', {
            type: 'object', properties: { removed: { type: 'integer', example: 1 } },
          }),
          ...errors,
        },
      },
    },
    '/inbox/conversations/{id}/read': {
      post: {
        tags: ['Inbox'], security: auth, summary: 'Mark the thread read',
        description:
          'Clears both counters that say nobody has looked at this thread: the conversation’s'
          + ' `unreadCount`, and any unread notification about it that the caller can see. One'
          + ' transaction, so the bell and the badge cannot disagree. Idempotent — call it on'
          + ' every thread open.',
        parameters: [pathParam('id', 'Conversation id')],
        responses: {
          200: ok('Marked read', {
            type: 'object',
            properties: {
              cleared: { type: 'boolean', description: 'False when the id matched no conversation.' },
              notificationsRead: { type: 'integer' },
            },
          }),
          ...errors,
        },
      },
    },
    '/inbox/conversations/{id}/assign': {
      post: {
        tags: ['Inbox'], security: auth, summary: 'Assign to a team member',
        description:
          'Needs `inbox:assign_self` to take it yourself, `inbox:assign_others` to give it to'
          + ' somebody else. Send `agentId: null` to unassign.',
        parameters: [pathParam('id', 'Conversation id')],
        requestBody: jsonBody({
          type: 'object', properties: { agentId: { type: 'string', format: 'uuid', nullable: true } },
        }),
        responses: { 200: ok('The conversation', ref('Conversation')), ...errors },
      },
    },
    '/inbox/conversations/{id}/automation': {
      post: {
        tags: ['Inbox'], security: auth, summary: 'Pause or resume the bot on this thread',
        description: 'Needs `inbox:toggle_automation`. Pausing sets the status to HUMAN_TAKEOVER.',
        parameters: [pathParam('id', 'Conversation id')],
        requestBody: jsonBody({ type: 'object', properties: { paused: { type: 'boolean' } }, required: ['paused'] }),
        responses: { 200: ok('The conversation', ref('Conversation')), ...errors },
      },
    },
    '/inbox/conversations/{id}/notes': {
      post: {
        tags: ['Inbox'], security: auth, summary: 'Add an internal note',
        description: 'Needs `inbox:add_note`. Never sent to the customer.',
        parameters: [pathParam('id', 'Conversation id')],
        requestBody: jsonBody({ type: 'object', properties: { body: { type: 'string' } }, required: ['body'] }),
        responses: { 201: ok('The note', { type: 'object' }), ...errors },
      },
    },
    '/conversations/{conversationId}/handoff': {
      post: {
        tags: ['Inbox'], security: auth, summary: 'Hand the thread to a human',
        parameters: [pathParam('conversationId', 'Conversation id')],
        responses: { 200: ok('Handed off', { type: 'object' }), ...errors },
      },
    },
    '/conversations/{conversationId}/resume-bot': {
      post: {
        tags: ['Inbox'], security: auth, summary: 'Give the thread back to the bot',
        parameters: [pathParam('conversationId', 'Conversation id')],
        responses: { 200: ok('Resumed', { type: 'object' }), ...errors },
      },
    },
    '/conversations/{conversationId}/routing-decisions': {
      get: {
        tags: ['Inbox'], security: auth, summary: 'Why the bot did what it did',
        description: 'Diagnostic. One row per inbound message, with the decision and its reason.',
        parameters: [pathParam('conversationId', 'Conversation id')],
        responses: { 200: ok('Decisions, newest first', { type: 'array', items: { type: 'object' } }), ...errors },
      },
    },
    '/conversations/{conversationId}/simulate': {
      post: {
        tags: ['Inbox'], security: auth, summary: 'Dry-run an inbound message',
        description:
          'Runs the routing engine without sending anything. For testing a workflow against a'
          + ' real conversation.',
        parameters: [pathParam('conversationId', 'Conversation id')],
        requestBody: jsonBody({ type: 'object', properties: { body: { type: 'string' } } }),
        responses: { 200: ok('What would have happened', { type: 'object' }), ...errors },
      },
    },

    // ── Customers ─────────────────────────────────────────────────────────────
    '/customers': {
      get: {
        tags: ['Customers'], security: auth, summary: 'List customers',
        description:
          'Needs `customers:read`. Paged. **`waId` and `phone` come back masked** unless the'
          + ' seat holds `customers:view_full_number` — the masking happens on the server, so'
          + ' the full number is never sent and then hidden.',
        parameters: [
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'listId', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'take', in: 'query', schema: { type: 'integer', default: 50, maximum: 100 } },
          { name: 'skip', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: { 200: okPaged('Customers', ref('Customer')), ...errors },
      },
      post: {
        tags: ['Customers'], security: auth, summary: 'Add a customer',
        description: 'Needs `customers:write`.',
        requestBody: jsonBody({ $ref: '#/components/schemas/CustomerUpdate' }),
        responses: { 201: ok('The customer', ref('Customer')), ...errors },
      },
    },
    '/customers/{id}': {
      get: {
        tags: ['Customers'], security: auth, summary: 'One customer',
        parameters: [pathParam('id', 'Customer id')],
        responses: { 200: ok('The customer', ref('Customer')), ...errors },
      },
      patch: {
        tags: ['Customers'], security: auth, summary: 'Update a customer',
        parameters: [pathParam('id', 'Customer id')],
        requestBody: jsonBody({ $ref: '#/components/schemas/CustomerUpdate' }),
        responses: { 200: ok('The customer', ref('Customer')), ...errors },
      },
    },
    '/customers/{id}/messages': {
      get: {
        tags: ['Customers'], security: auth, summary: 'Everything this customer has said',
        parameters: [pathParam('id', 'Customer id')],
        responses: { 200: ok('Messages', arrayOf('Message')), ...errors },
      },
    },
    '/customers/tags': {
      get: {
        tags: ['Customers'], security: auth, summary: 'Every tag in use',
        responses: { 200: ok('Tags', { type: 'array', items: { type: 'string' } }), ...errors },
      },
    },

    // ── Orders ────────────────────────────────────────────────────────────────
    '/orders': {
      get: {
        tags: ['Orders'], security: auth, summary: 'List orders',
        description: 'Needs `orders:read` and the ECOMMERCE module. Paged.',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'take', in: 'query', schema: { type: 'integer', default: 50 } },
          { name: 'skip', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: { 200: okPaged('Orders', ref('Order')), ...errors },
      },
      post: {
        tags: ['Orders'], security: auth, summary: 'Create an order',
        description: 'Needs `orders:write`.',
        requestBody: jsonBody({ type: 'object' }),
        responses: { 201: ok('The order', ref('Order')), ...errors },
      },
    },
    '/orders/summary': {
      get: {
        tags: ['Orders'], security: auth, summary: 'Totals across every order',
        description:
          'Separate from the list on purpose: the list is paged, so summing its page would'
          + ' report the revenue of fifty orders as the revenue of the business.',
        responses: { 200: ok('Totals', { type: 'object' }), ...errors },
      },
    },
    '/orders/{id}': {
      get: {
        tags: ['Orders'], security: auth, summary: 'One order',
        parameters: [pathParam('id', 'Order id')],
        responses: { 200: ok('The order', ref('Order')), ...errors },
      },
    },
    '/orders/{id}/status': {
      patch: {
        tags: ['Orders'], security: auth, summary: 'Move an order along',
        description: 'Needs `orders:write`. Only the transitions the workflow allows are accepted.',
        parameters: [pathParam('id', 'Order id')],
        requestBody: jsonBody({ type: 'object', properties: { status: { type: 'string' } }, required: ['status'] }),
        responses: { 200: ok('The order', ref('Order')), ...errors },
      },
    },

    // ── Catalogue ─────────────────────────────────────────────────────────────
    '/catalogue/categories': {
      get: {
        tags: ['Catalogue'], security: auth, summary: 'List categories',
        description:
          'Needs `catalogue:read` and the ECOMMERCE module. What a workspace *calls* its'
          + ' catalogue is on the session as `tenant.catalogueNoun` — a restaurant sees "Menu",'
          + ' a grocery sees "Products".',
        responses: { 200: ok('Categories', arrayOf('CatalogueCategory')), ...errors },
      },
      post: {
        tags: ['Catalogue'], security: auth, summary: 'Add a category',
        requestBody: jsonBody({ type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }),
        responses: { 201: ok('The category', ref('CatalogueCategory')), ...errors },
      },
    },
    '/catalogue/categories/{id}': {
      patch: {
        tags: ['Catalogue'], security: auth, summary: 'Rename a category',
        parameters: [pathParam('id', 'Category id')],
        requestBody: jsonBody({ type: 'object', properties: { name: { type: 'string' } } }),
        responses: { 200: ok('The category', ref('CatalogueCategory')), ...errors },
      },
      delete: {
        tags: ['Catalogue'], security: auth, summary: 'Remove a category',
        parameters: [pathParam('id', 'Category id')],
        responses: { 200: ok('Removed', { type: 'object' }), ...errors },
      },
    },
    '/catalogue/items': {
      get: {
        tags: ['Catalogue'], security: auth, summary: 'List items',
        parameters: [{ name: 'categoryId', in: 'query', schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: ok('Items', arrayOf('CatalogueItem')), ...errors },
      },
      post: {
        tags: ['Catalogue'], security: auth, summary: 'Add an item',
        requestBody: jsonBody({ $ref: '#/components/schemas/CatalogueItemUpdate' }),
        responses: { 201: ok('The item', ref('CatalogueItem')), ...errors },
      },
    },
    '/catalogue/items/{id}': {
      patch: {
        tags: ['Catalogue'], security: auth, summary: 'Update an item',
        parameters: [pathParam('id', 'Item id')],
        requestBody: jsonBody({ $ref: '#/components/schemas/CatalogueItemUpdate' }),
        responses: { 200: ok('The item', ref('CatalogueItem')), ...errors },
      },
      delete: {
        tags: ['Catalogue'], security: auth, summary: 'Remove an item',
        parameters: [pathParam('id', 'Item id')],
        responses: { 200: ok('Removed', { type: 'object' }), ...errors },
      },
    },
    '/catalogue/addon-groups': {
      get: {
        tags: ['Catalogue'], security: auth, summary: 'List add-on groups',
        responses: { 200: ok('Groups', { type: 'array', items: { type: 'object' } }), ...errors },
      },
      post: {
        tags: ['Catalogue'], security: auth, summary: 'Add an add-on group',
        requestBody: jsonBody({ type: 'object' }),
        responses: { 201: ok('The group', { type: 'object' }), ...errors },
      },
    },
    '/catalogue/addon-groups/{id}': {
      patch: {
        tags: ['Catalogue'], security: auth, summary: 'Update an add-on group',
        parameters: [pathParam('id', 'Group id')],
        requestBody: jsonBody({ type: 'object' }),
        responses: { 200: ok('The group', { type: 'object' }), ...errors },
      },
      delete: {
        tags: ['Catalogue'], security: auth, summary: 'Remove an add-on group',
        parameters: [pathParam('id', 'Group id')],
        responses: { 200: ok('Removed', { type: 'object' }), ...errors },
      },
    },

    // ── Notifications ─────────────────────────────────────────────────────────
    '/notifications': {
      get: {
        tags: ['Notifications'], security: auth, summary: 'The bell',
        description: 'This user\'s notifications, newest first. **Never carries a full phone number.**',
        parameters: [{ name: 'unreadOnly', in: 'query', schema: { type: 'boolean' } }],
        responses: { 200: ok('Notifications', arrayOf('Notification')), 401: errors[401] },
      },
    },
    '/notifications/unread-count': {
      get: {
        tags: ['Notifications'], security: auth, summary: 'How many are unread',
        description: 'Cheap enough to poll for a badge.',
        responses: {
          200: ok('The count', { type: 'object', properties: { count: { type: 'integer' } } }),
          401: errors[401],
        },
      },
    },
    '/notifications/{id}/read': {
      post: {
        tags: ['Notifications'], security: auth, summary: 'Mark one read',
        parameters: [pathParam('id', 'Notification id')],
        responses: { 200: ok('Marked read', { type: 'object' }), ...errors },
      },
    },
    '/notifications/read-all': {
      post: {
        tags: ['Notifications'], security: auth, summary: 'Mark everything read',
        responses: { 200: ok('Marked read', { type: 'object' }), 401: errors[401] },
      },
    },
    '/notifications/preferences': {
      get: {
        tags: ['Notifications'], security: auth, summary: 'Delivery preferences',
        responses: { 200: ok('Preferences', { type: 'object' }), 401: errors[401] },
      },
      put: {
        tags: ['Notifications'], security: auth, summary: 'Update delivery preferences',
        requestBody: jsonBody({ type: 'object' }),
        responses: { 200: ok('Preferences', { type: 'object' }), ...errors },
      },
    },
    '/notifications/push/devices': {
      get: {
        tags: ['Notifications'], security: auth, summary: 'Registered devices',
        description: [
          'Every device registered for push, browsers and phones together. `platform` is `WEB`,',
          '`ANDROID` or `IOS`. Neither the browser keys nor the FCM token are returned — use',
          '`id` with the DELETE below to unregister one.',
        ].join(' '),
        responses: { 200: ok('Devices', { type: 'array', items: { type: 'object' } }), 401: errors[401] },
      },
      post: {
        tags: ['Notifications'], security: auth, summary: 'Register this phone (FCM)',
        description: [
          'Call on sign-in and on every FCM token refresh. `deviceId` is the app\'s own install',
          'id, stable across token rotation — the same `deviceId` updates its row instead of',
          'adding a second one for the same phone. Also switches the `push` preference on.',
          '**422** means this server has no FCM credentials.',
        ].join(' '),
        requestBody: jsonBody({
          type: 'object',
          properties: {
            platform: { type: 'string', enum: ['ANDROID', 'IOS'] },
            token: { type: 'string', description: 'The FCM registration token' },
            deviceId: { type: 'string', description: 'Generated once by the app and kept' },
            deviceName: { type: 'string', example: 'Pixel 8' },
            appVersion: { type: 'string', example: '1.4.0' },
          },
          required: ['platform', 'token', 'deviceId'],
        }),
        responses: { 201: ok('Registered', { type: 'object' }), ...errors },
      },
    },
    '/notifications/push/devices/{id}': {
      delete: {
        tags: ['Notifications'], security: auth, summary: 'Unregister a device',
        description: [
          'What signing out of the app calls. Works for a browser row too. Idempotent — an id',
          'that is already gone answers 200 with `removed: 0`. Deliberately leaves the `push`',
          'preference alone: the person may still want push on their other phone.',
        ].join(' '),
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: ok('Removed', { type: 'object' }), 401: errors[401] },
      },
    },
    '/notifications/push/subscribe': {
      post: {
        tags: ['Notifications'], security: auth, summary: 'Register a Web Push subscription',
        requestBody: jsonBody({ type: 'object' }),
        responses: { 200: ok('Registered', { type: 'object' }), ...errors },
      },
    },
    '/notifications/push/unsubscribe': {
      post: {
        tags: ['Notifications'], security: auth, summary: 'Remove a Web Push subscription',
        requestBody: jsonBody({ type: 'object' }),
        responses: { 200: ok('Removed', { type: 'object' }), ...errors },
      },
    },

    // ── Media ─────────────────────────────────────────────────────────────────
    '/media': {
      get: {
        tags: ['Media'], security: auth, summary: 'The workspace\'s uploaded files',
        description: [
          'Needs `campaigns:read`. **Uploads only** — files customers sent are not listed here, and',
          '`GET /media/{id}/file` is the only way to reach one. The two are deliberately separate:',
          'a library an operator browses and a customer\'s private photograph are not the same thing.',
        ].join(' '),
        parameters: [
          { name: 'kind', in: 'query', schema: { type: 'string', enum: ['IMAGE', 'VIDEO', 'DOCUMENT'] } },
        ],
        responses: { 200: ok('Files', arrayOf('MediaAsset')), ...errors },
      },
      post: {
        tags: ['Media'], security: auth, summary: 'Upload a file',
        description: [
          'Needs `campaigns:write`. `multipart/form-data` with one part named `file`.',
          '',
          '**The kind is decided from the bytes, not from anything you send.** A caller claiming',
          'IMAGE for an MP4 would produce a send WhatsApp refuses, and the file is the only honest',
          'source. A type WhatsApp does not accept is a 400 naming what it does — as is a file over',
          'the limit for its kind, with both sizes in the message.',
        ].join('\n'),
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: { file: { type: 'string', format: 'binary' } },
                required: ['file'],
              },
            },
          },
        },
        responses: { 201: ok('The stored file', ref('MediaAsset')), ...errors },
      },
    },
    '/media/rules': {
      get: {
        tags: ['Media'], security: auth, summary: 'What may be uploaded',
        description: [
          'Needs `campaigns:read`. Read this instead of hardcoding the limits — they are',
          "WhatsApp's, and `label` is written to be shown to a person as it stands.",
          '',
          '`publicUrlReachable` is false when this server\'s `APP_URL` cannot be fetched from the',
          'internet, which is normal in development. Campaign header media will not work while it',
          'is false, because Meta fetches the file itself; conversation media is unaffected.',
        ].join('\n'),
        responses: {
          200: ok('The rules', {
            type: 'object',
            properties: {
              kinds: {
                type: 'object',
                description: 'Keyed by IMAGE, VIDEO and DOCUMENT.',
                additionalProperties: {
                  type: 'object',
                  properties: {
                    mimeTypes: { type: 'array', items: { type: 'string' } },
                    maxBytes: { type: 'integer', example: 5242880 },
                    label: { type: 'string', example: 'JPEG or PNG, up to 5 MB' },
                  },
                },
              },
              publicUrlReachable: { type: 'boolean' },
            },
          }),
          ...errors,
        },
      },
    },
    '/media/{id}': {
      delete: {
        tags: ['Media'], security: auth, summary: 'Remove an uploaded file',
        description:
          'Needs `campaigns:write`. Removes the row and the bytes. A message already sent with it'
          + ' keeps its `mediaUrl`, which will then 404 — the customer\'s copy is unaffected either'
          + ' way, since WhatsApp delivered its own.',
        parameters: [pathParam('id', 'Media id')],
        responses: { 200: ok('Removed', { type: 'object' }), ...errors },
      },
    },
    '/media/{id}/file': {
      get: {
        tags: ['Media'], security: auth, summary: 'The bytes',
        description: [
          'Needs `inbox:read`. **This is what `mediaUrl` on a message points at**, in both',
          'directions — what the customer sent and what the business sent back.',
          '',
          'Authenticated and scoped to the workspace, so send the bearer token. In Flutter that',
          'means `Image.network(url, headers: {...})` or fetching the bytes yourself; a plain',
          '`<img src>`-style load with no header gets a 401 and renders as a broken image.',
          '',
          'Streamed through the API rather than redirecting to a presigned URL, deliberately: the',
          'URL stops working the moment the session does, instead of remaining usable by anyone',
          'holding it until it expires. Answers `Cache-Control: private, max-age=3600`, so caching',
          'the bytes on the device for an hour is safe and re-fetching on every scroll is not',
          'necessary.',
        ].join('\n'),
        parameters: [pathParam('id', 'Media id')],
        responses: {
          200: {
            description: 'The file. `Content-Type` is the stored MIME type.',
            content: { '*/*': { schema: { type: 'string', format: 'binary' } } },
          },
          401: errors[401],
          403: errors[403],
          404: errors[404],
        },
      },
    },

    // ── Quick replies ─────────────────────────────────────────────────────────
    '/quick-replies': {
      get: {
        tags: ['Quick replies'], security: auth, summary: 'The sets an agent can send',
        description: [
          'Needs `inbox:reply`. **What comes back depends on what the caller may do**: somebody who',
          'can only send gets the active sets, which are the ones they can actually use; somebody',
          'with `automation:write` gets all of them, retired included, because that is the list they',
          'manage.',
          '',
          'Each button carries its `workflow` when one is bound. A button whose workflow is no longer',
          '`PUBLISHED` will not start anything when tapped — show that, rather than promising it.',
        ].join(' '),
        responses: { 200: ok('Sets', arrayOf('QuickReply')), ...errors },
      },
      post: {
        tags: ['Quick replies'], security: auth, summary: 'Save a set',
        description: [
          'Needs `automation:write` — **not** `inbox:reply`. A button can be bound to a workflow, and',
          'deciding what a customer\'s tap starts is configuring the automation rather than answering',
          'a message.',
          '',
          'Meta\'s limits are enforced here rather than discovered at send time: at most three',
          'buttons, 20 characters a label (past which Meta truncates silently), 1024 characters of',
          'body. Two answers may not read the same. A bound workflow must be published and belong to',
          'this workspace.',
          '',
          '**Buttons carry no id.** They are minted from the row, and supplying one is a 400 rather',
          'than a silent drop — an id a client chooses is an id that can collide with the ordering',
          'flow\'s own.',
        ].join('\n'),
        requestBody: jsonBody(ref('QuickReplyInput')),
        responses: { 201: ok('The set', ref('QuickReply')), ...errors },
      },
    },
    '/quick-replies/{id}': {
      get: {
        tags: ['Quick replies'], security: auth, summary: 'One set',
        parameters: [pathParam('id', 'Set id')],
        responses: { 200: ok('The set', ref('QuickReply')), ...errors },
      },
      patch: {
        tags: ['Quick replies'], security: auth, summary: 'Edit a set',
        description: [
          'Needs `automation:write`. Send `isActive: false` to retire a set — it stops being offered',
          'to agents and stays in this list.',
          '',
          '**Sending `buttons` replaces them all, with new ids.** A button\'s id is its identity on',
          'WhatsApp, so relabelling in place would change what a tap on an already-sent question',
          'means. Omit `buttons` to leave the outstanding ones working.',
        ].join('\n'),
        parameters: [pathParam('id', 'Set id')],
        requestBody: jsonBody(ref('QuickReplyInput')),
        responses: { 200: ok('The set', ref('QuickReply')), ...errors },
      },
      delete: {
        tags: ['Quick replies'], security: auth, summary: 'Delete a set',
        description:
          'Needs `automation:write`. Prefer `isActive: false` — deleting means a tap on a question'
          + ' already on a customer\'s phone resolves to nothing, and is recorded for the agent to'
          + ' answer instead.',
        parameters: [pathParam('id', 'Set id')],
        responses: { 200: ok('Deleted', { type: 'object' }), ...errors },
      },
    },

    // ── Support ───────────────────────────────────────────────────────────────
    '/tickets': {
      get: {
        tags: ['Support'], security: auth, summary: 'List tickets',
        description: 'Needs `tickets:read` and the SUPPORT module.',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'assigneeId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { 200: ok('Tickets', arrayOf('Ticket')), ...errors },
      },
      post: {
        tags: ['Support'], security: auth, summary: 'Raise a ticket',
        description: 'Needs `tickets:write`. Usually raised from a conversation.',
        requestBody: jsonBody({
          type: 'object',
          properties: {
            subject: { type: 'string' },
            body: { type: 'string' },
            priority: { type: 'string', enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'] },
            conversationId: { type: 'string', format: 'uuid' },
          },
          required: ['subject'],
        }),
        responses: { 201: ok('The ticket', ref('Ticket')), ...errors },
      },
    },
    '/tickets/{ticketId}': {
      get: {
        tags: ['Support'], security: auth, summary: 'One ticket with its timeline',
        parameters: [pathParam('ticketId', 'Ticket id')],
        responses: { 200: ok('The ticket', ref('Ticket')), ...errors },
      },
    },
    '/tickets/{ticketId}/status': {
      patch: {
        tags: ['Support'], security: auth, summary: 'Change the status',
        description: 'Closing needs `tickets:close`.',
        parameters: [pathParam('ticketId', 'Ticket id')],
        requestBody: jsonBody({ type: 'object', properties: { status: { type: 'string' } }, required: ['status'] }),
        responses: { 200: ok('The ticket', ref('Ticket')), ...errors },
      },
    },
    '/tickets/{ticketId}/assignee': {
      patch: {
        tags: ['Support'], security: auth, summary: 'Assign the ticket',
        description: 'Needs `tickets:assign`.',
        parameters: [pathParam('ticketId', 'Ticket id')],
        requestBody: jsonBody({
          type: 'object', properties: { assigneeId: { type: 'string', format: 'uuid', nullable: true } },
        }),
        responses: { 200: ok('The ticket', ref('Ticket')), ...errors },
      },
    },
    '/tickets/{ticketId}/notes': {
      post: {
        tags: ['Support'], security: auth, summary: 'Add an internal note',
        parameters: [pathParam('ticketId', 'Ticket id')],
        requestBody: jsonBody({ type: 'object', properties: { body: { type: 'string' } }, required: ['body'] }),
        responses: { 201: ok('The note', { type: 'object' }), ...errors },
      },
    },
    '/tickets/{ticketId}/updates': {
      post: {
        tags: ['Support'], security: auth, summary: 'Send the customer an update on WhatsApp',
        description:
          'Honours the 24-hour window. If WhatsApp refuses, the text is **still saved on the'
          + ' ticket** and the response says why rather than losing what was written.',
        parameters: [pathParam('ticketId', 'Ticket id')],
        requestBody: jsonBody({ type: 'object', properties: { message: { type: 'string' } }, required: ['message'] }),
        responses: { 200: ok('What happened', { type: 'object' }), ...errors },
      },
    },

    // ── Leads ─────────────────────────────────────────────────────────────────
    '/leads': {
      get: {
        tags: ['Leads'], security: auth, summary: 'The pipeline',
        description: 'Needs `leads:read` and the LEADS module.',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'ownerId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { 200: ok('Leads', arrayOf('Lead')), ...errors },
      },
      post: {
        tags: ['Leads'], security: auth, summary: 'Add a lead',
        requestBody: jsonBody({ type: 'object' }),
        responses: { 201: ok('The lead', ref('Lead')), ...errors },
      },
    },
    '/leads/{leadId}': {
      get: {
        tags: ['Leads'], security: auth, summary: 'One lead with its timeline',
        parameters: [pathParam('leadId', 'Lead id')],
        responses: { 200: ok('The lead', ref('Lead')), ...errors },
      },
      patch: {
        tags: ['Leads'], security: auth, summary: 'Update a lead',
        parameters: [pathParam('leadId', 'Lead id')],
        requestBody: jsonBody({ type: 'object' }),
        responses: { 200: ok('The lead', ref('Lead')), ...errors },
      },
      delete: {
        tags: ['Leads'], security: auth, summary: 'Remove a lead',
        description: 'Needs `leads:delete`.',
        parameters: [pathParam('leadId', 'Lead id')],
        responses: { 200: ok('Removed', { type: 'object' }), ...errors },
      },
    },
    '/leads/{leadId}/status': {
      patch: {
        tags: ['Leads'], security: auth, summary: 'Move it along the pipeline',
        parameters: [pathParam('leadId', 'Lead id')],
        requestBody: jsonBody({ type: 'object', properties: { status: { type: 'string' } }, required: ['status'] }),
        responses: { 200: ok('The lead', ref('Lead')), ...errors },
      },
    },
    '/leads/{leadId}/owner': {
      patch: {
        tags: ['Leads'], security: auth, summary: 'Change the owner',
        description: 'Needs `leads:assign`.',
        parameters: [pathParam('leadId', 'Lead id')],
        requestBody: jsonBody({
          type: 'object', properties: { ownerId: { type: 'string', format: 'uuid', nullable: true } },
        }),
        responses: { 200: ok('The lead', ref('Lead')), ...errors },
      },
    },
    '/leads/{leadId}/notes': {
      post: {
        tags: ['Leads'], security: auth, summary: 'Add a note',
        parameters: [pathParam('leadId', 'Lead id')],
        requestBody: jsonBody({ type: 'object', properties: { body: { type: 'string' } }, required: ['body'] }),
        responses: { 201: ok('The note', { type: 'object' }), ...errors },
      },
    },
    '/leads/{leadId}/calls': {
      post: {
        tags: ['Leads'], security: auth, summary: 'Log a call',
        description: 'What the click-to-dial button records after the call.',
        parameters: [pathParam('leadId', 'Lead id')],
        requestBody: jsonBody({ type: 'object' }),
        responses: { 201: ok('The call', { type: 'object' }), ...errors },
      },
    },
    '/leads/{leadId}/reminders': {
      post: {
        tags: ['Leads'], security: auth, summary: 'Set a reminder',
        parameters: [pathParam('leadId', 'Lead id')],
        requestBody: jsonBody({
          type: 'object',
          properties: { dueAt: { type: 'string', format: 'date-time' }, note: { type: 'string' } },
          required: ['dueAt'],
        }),
        responses: { 201: ok('The reminder', { type: 'object' }), ...errors },
      },
    },
    '/leads/reminders/mine': {
      get: {
        tags: ['Leads'], security: auth, summary: 'My reminders',
        responses: { 200: ok('Reminders', { type: 'array', items: { type: 'object' } }), ...errors },
      },
    },
    '/leads/reminders/{reminderId}/complete': {
      patch: {
        tags: ['Leads'], security: auth, summary: 'Tick a reminder off',
        parameters: [pathParam('reminderId', 'Reminder id')],
        responses: { 200: ok('The reminder', { type: 'object' }), ...errors },
      },
    },
    '/leads/bulk-assign': {
      post: {
        tags: ['Leads'], security: auth, summary: 'Assign several leads at once',
        description: 'Needs `leads:assign`.',
        requestBody: jsonBody({
          type: 'object',
          properties: {
            leadIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
            ownerId: { type: 'string', format: 'uuid', nullable: true },
          },
          required: ['leadIds'],
        }),
        responses: { 200: ok('How many moved', { type: 'object' }), ...errors },
      },
    },
  },

  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http', scheme: 'bearer', bearerFormat: 'JWT',
        description: 'The token from `POST /auth/otp/verify`. Currently valid for 24 hours.',
      },
    },

    responses: {
      BadRequest: {
        description: 'The request was not acceptable. `message` says why, in plain words.',
        content: { 'application/json': { schema: ref('Error') } },
      },
      Unauthorised: {
        description: 'No token, or an expired one.',
        content: { 'application/json': { schema: ref('Error') } },
      },
      Forbidden: {
        description: 'Signed in, but this seat does not hold the permission this route needs.',
        content: { 'application/json': { schema: ref('Error') } },
      },
      NotFound: {
        description:
          'Not found — **or the workspace does not have the module that owns this route.**'
          + ' The two are deliberately the same answer, so a workspace cannot probe for'
          + ' features it was never sold.',
        content: { 'application/json': { schema: ref('Error') } },
      },
      TooManyRequests: {
        description: 'Rate limited. Back off and retry.',
        content: { 'application/json': { schema: ref('Error') } },
      },
      WhatsappRefused: {
        description:
          'WhatsApp refused the message, and `message` carries Meta\'s own explanation —'
          + ' the 24-hour window has closed, the number is not on a sandbox allow-list, a'
          + ' template is unapproved. Not a server fault; show it to the user.',
        content: { 'application/json': { schema: ref('Error') } },
      },
      WhatsappDisconnected: {
        description:
          'The workspace\'s WhatsApp access token has expired or been revoked. Nothing can be'
          + ' sent until an owner reconnects in Settings.',
        content: { 'application/json': { schema: ref('Error') } },
      },
    },

    schemas: {
      Error: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          message: { type: 'string', example: 'This conversation is assigned to someone else.' },
          details: { description: 'Field-level problems, when the failure was a validation one' },
        },
        required: ['success', 'message'],
      },
      DeltaMeta: {
        type: 'object',
        description: 'Where to resume from. Echo the two cursor fields back on the next call.',
        properties: {
          nextSince: {
            type: 'string', format: 'date-time',
            description:
              'Send as `since` next time. On an empty delta this is the cursor you sent, unchanged —'
              + ' it deliberately does not jump to now, because nothing was observed in between.',
          },
          nextSinceId: {
            type: 'string', nullable: true,
            description: 'Send as `sinceId` next time. Breaks ties at `nextSince`.',
          },
          hasMore: {
            type: 'boolean',
            description:
              'The page was full and more is already waiting. Call again immediately rather than'
              + ' waiting for the next tick.',
          },
        },
      },
      PageMeta: {
        type: 'object',
        properties: {
          total: { type: 'integer', description: 'Rows matching the filter, not rows in this page' },
          take: { type: 'integer' },
          skip: { type: 'integer' },
        },
      },
      Session: {
        type: 'object',
        description: 'Everything a client needs on launch.',
        properties: {
          user: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              phone: { type: 'string', nullable: true },
              email: { type: 'string', nullable: true },
              fullName: { type: 'string' },
              role: { type: 'string', enum: ['OWNER', 'MANAGER', 'AGENT'] },
              emailVerified: { type: 'boolean' },
              country: { type: 'string', nullable: true, example: 'IN' },
            },
          },
          tenant: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              businessName: { type: 'string' },
              category: { type: 'string', nullable: true, example: 'RESTAURANT' },
              categoryLabel: { type: 'string', nullable: true },
              catalogueNoun: {
                type: 'string', example: 'Menu',
                description: 'What this business calls its catalogue. Use it in the UI.',
              },
              catalogueItemNoun: { type: 'string', example: 'Item' },
              maskCustomerNumbers: { type: 'boolean' },
              aiAgentEnabled: { type: 'boolean' },
              onboardingCompleted: { type: 'boolean' },
            },
          },
          permissions: {
            type: 'array', items: { type: 'string' },
            description: 'What this seat may do, e.g. `inbox:reply`. For hiding UI, never for trusting.',
          },
          modules: {
            type: 'array',
            items: { type: 'string', enum: ['MARKETING', 'LEADS', 'SUPPORT', 'AI_AGENT', 'ECOMMERCE', 'KEYWORD_RULES'] },
            description: 'Which optional modules this workspace has. A missing one 404s its routes.',
          },
          activeWorkspaceId: {
            type: 'string', format: 'uuid',
            description:
              'The workspace this session is acting in. Same value as `tenant.id`, carried'
              + ' separately so a switcher can mark one row without comparing shapes.',
          },
          workspaces: {
            type: 'array', items: ref('Workspace'),
            description:
              'Every workspace this login can reach. One entry for a normal account. Absent from a'
              + ' session minted before this field existed — treat that as "cannot switch".',
          },
        },
      },
      Workspace: {
        type: 'object',
        description: 'One workspace this login belongs to, as a switcher needs it.',
        properties: {
          id: { type: 'string', format: 'uuid' },
          businessName: { type: 'string' },
          logoUrl: { type: 'string', nullable: true },
          roleName: {
            type: 'string', nullable: true,
            description:
              'The workspace’s own name for the role — "Owner", "Shift lead". Not the legacy enum,'
              + ' which would contradict what the Team screen shows.',
          },
          isOwner: { type: 'boolean' },
          joinedAt: { type: 'string', format: 'date-time' },
          isSuspended: {
            type: 'boolean',
            description:
              'Listed even though it cannot be entered. Hiding it would make a business vanish from'
              + ' the switcher with no explanation.',
          },
          isCurrent: { type: 'boolean' },
        },
      },
      Tenant: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          businessName: { type: 'string' },
          contactNumber: { type: 'string', nullable: true },
          address: { type: 'string', nullable: true },
          website: { type: 'string', nullable: true },
          logoUrl: { type: 'string', nullable: true },
          maskCustomerNumbers: { type: 'boolean' },
          aiAgentEnabled: { type: 'boolean' },
        },
      },
      TenantUpdate: {
        type: 'object',
        properties: {
          businessName: { type: 'string' },
          contactNumber: { type: 'string' },
          address: { type: 'string' },
          website: { type: 'string' },
          maskCustomerNumbers: { type: 'boolean' },
          aiAgentEnabled: {
            type: 'boolean',
            description:
              'The workspace half of the AI switch. An operator can revoke the AI_AGENT module'
              + ' above this, and that ceiling cannot be lifted from here.',
          },
        },
      },
      StaffMember: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          fullName: { type: 'string' },
          email: { type: 'string', nullable: true },
        },
      },
      Conversation: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          status: { type: 'string', enum: ['OPEN', 'HUMAN_TAKEOVER', 'CLOSED'] },
          unreadCount: { type: 'integer' },
          automationPaused: { type: 'boolean' },
          lastMessageAt: { type: 'string', format: 'date-time', nullable: true },
          customer: ref('Customer'),
          assignedAgent: { allOf: [ref('StaffMember')], nullable: true },
        },
      },
      Message: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          direction: { type: 'string', enum: ['INBOUND', 'OUTBOUND'] },
          type: {
            type: 'string',
            enum: ['TEXT', 'IMAGE', 'DOCUMENT', 'AUDIO', 'VIDEO', 'LOCATION', 'INTERACTIVE',
              'TEMPLATE', 'SYSTEM'],
            example: 'TEXT',
            description:
              'Anything but `TEXT` normally carries a `mediaUrl`. `body` is still set on a media'
              + ' message — the caption if there was one, otherwise a short description such as'
              + ' "Sent a photo", so a list preview has something to show.',
          },
          status: {
            type: 'string',
            enum: ['SENT', 'DELIVERED', 'READ', 'FAILED', 'RECEIVED'],
            example: 'READ',
            description:
              'Delivery state, from Meta. `RECEIVED` is the inbound default. **Take the state'
              + ' from here, not from the timestamps below** — Meta delivers status webhooks out'
              + ' of order and the server refuses to move a message backwards, so a set `readAt`'
              + ' beside a null `deliveredAt` is normal rather than missing data.',
          },
          replyToId: {
            type: 'string', format: 'uuid', nullable: true,
            description: 'The message this one quotes, in either direction.',
          },
          replyTo: {
            type: 'object', nullable: true,
            description:
              'A snippet of the quoted message. **Null once the quoted message is removed from'
              + ' the inbox**, so a removal cannot leak back through a reply to it. One level'
              + ' deep — a reply to a reply carries its own quote, not a chain.',
            properties: {
              id: { type: 'string', format: 'uuid' },
              direction: { type: 'string', enum: ['INBOUND', 'OUTBOUND'] },
              type: { type: 'string', example: 'TEXT' },
              body: { type: 'string', nullable: true },
            },
          },
          deliveredAt: { type: 'string', format: 'date-time', nullable: true },
          readAt: { type: 'string', format: 'date-time', nullable: true },
          failedAt: { type: 'string', format: 'date-time', nullable: true },
          statusError: {
            type: 'string', nullable: true,
            description:
              "Why Meta refused it, in Meta's own words, with phone numbers scrubbed. Set only"
              + ' alongside `FAILED`.',
            example: '131030: Add recipient phone number to recipient list',
          },
          body: { type: 'string', nullable: true },
          mediaUrl: {
            type: 'string', nullable: true,
            example: '/api/media/6c3acaa4-2284-4e45-8d65-e17fc45d8fd8/file',
            description:
              '**A relative path on this API, not a public URL.** Prefix it with the API base and'
              + ' send the bearer token; without the header it is a 401. Null on a text message,'
              + ' and null on a media message whose file could not be captured from Meta — the'
              + ' message still exists and `body` says what kind of thing it was.',
          },
          waMessageId: { type: 'string', nullable: true },
          sentByUserId: {
            type: 'string', format: 'uuid', nullable: true,
            description: 'Null on an OUTBOUND message means the bot sent it, not a person.',
          },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      QuickReply: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', description: 'How an agent picks it. Never sent to the customer.' },
          body: {
            type: 'string',
            description:
              'The question, and a default rather than a fixed message — the send may override it'
              + ' for one conversation.',
          },
          isActive: { type: 'boolean', description: 'Retired sets are not offered to agents.' },
          buttons: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                label: { type: 'string', maxLength: 20 },
                position: { type: 'integer' },
                workflowId: { type: 'string', format: 'uuid', nullable: true },
                workflow: {
                  type: 'object', nullable: true,
                  description:
                    'What tapping it starts. **A tap only starts it while `status` is `PUBLISHED`**,'
                    + ' and it also hands the conversation back to the bot, ending any human takeover.',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    name: { type: 'string' },
                    status: { type: 'string', example: 'PUBLISHED' },
                  },
                },
              },
            },
          },
        },
      },
      QuickReplyInput: {
        type: 'object',
        properties: {
          name: { type: 'string', maxLength: 80 },
          body: { type: 'string', maxLength: 1024 },
          isActive: { type: 'boolean', description: 'PATCH only.' },
          buttons: {
            type: 'array',
            minItems: 1,
            maxItems: 3,
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', maxLength: 20 },
                workflowId: {
                  type: 'string', format: 'uuid', nullable: true,
                  description: 'A published workflow in this workspace, or null for a plain answer.',
                },
              },
              required: ['label'],
            },
          },
        },
        required: ['name', 'body', 'buttons'],
      },
      MediaAsset: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          kind: { type: 'string', enum: ['IMAGE', 'VIDEO', 'DOCUMENT'] },
          mimeType: { type: 'string', example: 'image/jpeg' },
          sizeBytes: { type: 'integer' },
          originalName: {
            type: 'string',
            description: 'As the uploader named it. Display only — never used to build a path.',
          },
          url: {
            type: 'string',
            description:
              'The **public** link, for a campaign template header, which Meta fetches itself.'
              + ' Not the route a signed-in client should use for a conversation file: that is'
              + ' `/api/media/{id}/file`, and it is the one that keeps working when an asset is'
              + ' private.',
          },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Customer: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: {
            type: 'string',
            nullable: true,
            description:
              'The **operator’s own label** for this person, e.g. `Ravi — accounts`. Null unless'
              + ' somebody typed one. Never written by the webhook, and never sent to the'
              + ' customer — use `waProfileName` for anything they will read.',
          },
          waProfileName: {
            type: 'string',
            nullable: true,
            description:
              'What WhatsApp reports this person calls themselves, refreshed on every inbound'
              + ' message. For a WhatsApp Business account this is the business’s display name.'
              + ' Read-only: it is the only profile field Meta exposes — there is no contact'
              + ' photo and nothing marks the sender as a business.',
          },
          waId: {
            type: 'string',
            description:
              'The WhatsApp number, E.164 digits with no plus. **Masked to `+••••••1234`**'
              + ' unless the seat holds `customers:view_full_number`.',
          },
          phone: { type: 'string', nullable: true },
          tags: { type: 'array', items: { type: 'string' } },
          marketingOptIn: { type: 'boolean' },
          optedOutAt: { type: 'string', format: 'date-time', nullable: true },
          lastSeenAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      CustomerUpdate: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          phone: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
      },
      Order: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          status: { type: 'string' },
          totalPaise: {
            type: 'integer',
            description: 'Money is always an integer number of paise. Never a float.',
          },
          customer: ref('Customer'),
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      CatalogueCategory: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          isActive: { type: 'boolean' },
        },
      },
      CatalogueItem: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          description: { type: 'string', nullable: true },
          pricePaise: { type: 'integer', description: 'Paise, as an integer.' },
          inStock: { type: 'boolean' },
          categoryId: { type: 'string', format: 'uuid', nullable: true },
        },
      },
      CatalogueItemUpdate: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          pricePaise: { type: 'integer' },
          inStock: { type: 'boolean' },
          categoryId: { type: 'string', format: 'uuid' },
        },
      },
      Notification: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          type: { type: 'string', example: 'INBOUND_MESSAGE' },
          title: { type: 'string' },
          body: { type: 'string', nullable: true },
          readAt: { type: 'string', format: 'date-time', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Ticket: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          number: { type: 'string', example: 'TKT-0042' },
          subject: { type: 'string' },
          status: { type: 'string' },
          priority: { type: 'string', enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'] },
          customer: { allOf: [ref('Customer')], nullable: true },
          assignee: { allOf: [ref('StaffMember')], nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Lead: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', nullable: true },
          status: { type: 'string' },
          owner: { allOf: [ref('StaffMember')], nullable: true },
          customer: { allOf: [ref('Customer')], nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
} as const;
