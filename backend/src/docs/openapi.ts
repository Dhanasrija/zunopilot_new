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
  '/api/notifications',
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
      '### Push notifications',
      'The endpoints under `/notifications/push` are **Web Push (VAPID)**. There is no FCM or',
      'APNs support yet, so a native client cannot receive pushes through them — the in-app',
      'list and unread count under `/notifications` do work.',
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
    { name: 'Notifications', description: 'The bell, its unread count, and delivery preferences' },
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
        ],
        responses: { 200: ok('Conversations', arrayOf('Conversation')), ...errors },
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
      get: {
        tags: ['Inbox'], security: auth, summary: 'The messages in a conversation',
        parameters: [pathParam('id', 'Conversation id')],
        responses: { 200: ok('Messages, oldest first', arrayOf('Message')), ...errors },
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
          type: 'object', properties: { body: { type: 'string' } }, required: ['body'],
        }),
        responses: {
          201: ok('The message that was sent', ref('Message')),
          422: { $ref: '#/components/responses/WhatsappRefused' },
          424: { $ref: '#/components/responses/WhatsappDisconnected' },
          ...errors,
        },
      },
    },
    '/inbox/conversations/{id}/read': {
      post: {
        tags: ['Inbox'], security: auth, summary: 'Clear the unread count',
        parameters: [pathParam('id', 'Conversation id')],
        responses: { 200: ok('Marked read', ref('Conversation')), ...errors },
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
        tags: ['Notifications'], security: auth, summary: 'Registered Web Push devices',
        description: '**Web Push only — not FCM or APNs.** A native client cannot use these yet.',
        responses: { 200: ok('Devices', { type: 'array', items: { type: 'object' } }), 401: errors[401] },
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
          type: { type: 'string', example: 'TEXT' },
          status: { type: 'string', example: 'SENT' },
          body: { type: 'string', nullable: true },
          mediaUrl: { type: 'string', nullable: true },
          waMessageId: { type: 'string', nullable: true },
          sentByUserId: {
            type: 'string', format: 'uuid', nullable: true,
            description: 'Null on an OUTBOUND message means the bot sent it, not a person.',
          },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Customer: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', nullable: true },
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
