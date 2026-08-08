import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { prisma } from '../config/prisma.js';
import { signToken } from '../utils/jwt.js';
import { ROLE_PERMISSIONS } from '../config/permissions.js';

/*
 * One workspace must never see another's rows.
 *
 * ── Why this file exists now ─────────────────────────────────────────────────
 *
 * Written **before** the `Membership` table lands, deliberately. Today one user belongs to
 * exactly one workspace, so `req.tenantId` is structurally guaranteed: it is read off the user
 * row, and a user row always has one. Memberships remove that guarantee — the tenant starts
 * coming from a token claim, which means there is a path where it can be absent or wrong.
 *
 * **The failure mode is not a 500.** `tenantIdOf` exists because Prisma treats
 * `where: { tenantId: undefined }` as *no filter at all* and cheerfully returns every tenant's
 * rows (see the comment at `middleware/auth.ts:178`). A dropped or undefined tenant is a silent
 * cross-workspace read with a 200 status. So these properties are pinned now, against behaviour
 * that is known-good, and the membership work has to keep them green.
 *
 * ── How the assertion works ──────────────────────────────────────────────────
 *
 * Two workspaces are seeded by **one function**, so they are provably identical in shape, and
 * every text field in each carries that workspace's sentinel word. Then for every list endpoint:
 * the body must contain your own sentinel and must not contain the other's.
 *
 * Asserting on the body rather than on counts or ids is what makes this cheap to extend — it
 * needs no knowledge of each endpoint's response shape, and a leak anywhere in a nested include
 * is caught just as well as one at the top level. **Both halves are load-bearing:** without the
 * own-sentinel assertion an endpoint that returned `[]` would pass vacuously, which is exactly
 * how a scoping test rots into a tautology.
 *
 * ── What this file does *not* cover ──────────────────────────────────────────
 *
 * The anonymous cases below prove that **`requireAuth` guards these routes**. They do not touch
 * `tenantIdOf`'s own throw, because `requireAuth` refuses first and no handler is ever reached —
 * deleting that throw leaves every test here green. `middleware/tenant-scope.test.ts` holds the
 * backstop at its own level. Found by mutation, not by reading.
 */

const app = buildApp();

const ALPHA = 'aaaa1111-0000-0000-0000-00000000a001';
const BRAVO = 'aaaa1111-0000-0000-0000-00000000a002';

/** The word that must appear in one workspace's responses and never in the other's. */
const SENTINEL = { [ALPHA]: 'ALPHAONLY', [BRAVO]: 'BRAVOONLY' } as const;

interface Seeded {
  tenantId: string;
  token: string;
  /** A second member, so the team roster has more than one row to leak. */
  colleagueId: string;
  customerId: string;
  conversationId: string;
}

/**
 * A whole workspace: one of everything a list endpoint can return.
 *
 * The three optional modules are switched on explicitly — `MARKETING`, `LEADS` and `SUPPORT`
 * default to off, so without these rows their routers 404 and the leads, tickets and campaigns
 * rows below would be seeded and never looked at.
 */
const seed = async (tenantId: string, phoneStem: string): Promise<Seeded> => {
  const mark = SENTINEL[tenantId as keyof typeof SENTINEL];

  const tenant = await prisma.tenant.create({
    data: {
      id: tenantId,
      businessName: `${mark} Trading`,
      category: 'RESTAURANT',
      roles: {
        create: [
          { name: 'Owner', permissions: [...ROLE_PERMISSIONS.OWNER], isOwner: true, isSystem: true },
          // A custom role, named with the sentinel, so `GET /roles` has something to leak.
          { name: `${mark} shift lead`, permissions: ['inbox:read'], sortOrder: 90 },
        ],
      },
      modules: {
        create: (['MARKETING', 'LEADS', 'SUPPORT'] as const).map((module) => ({
          module, enabled: true,
        })),
      },
    },
    include: { roles: true },
  });
  const ownerRole = tenant.roles.find((r) => r.isOwner)!;

  const owner = await prisma.user.create({
    data: {
      tenantId, phone: `${phoneStem}01`, fullName: `${mark} Owner`, role: 'OWNER', roleId: ownerRole.id,
    },
  });
  const colleague = await prisma.user.create({
    data: {
      tenantId, phone: `${phoneStem}02`, fullName: `${mark} Colleague`, role: 'AGENT', roleId: ownerRole.id,
    },
  });

  const customer = await prisma.customer.create({
    data: { tenantId, waId: `${phoneStem}77`, name: `${mark} Customer`, waProfileName: `${mark} Customer` },
  });

  const conversation = await prisma.conversation.create({
    data: { tenantId, customerId: customer.id, status: 'OPEN', lastMessageAt: new Date() },
  });
  await prisma.message.create({
    data: {
      tenantId,
      conversationId: conversation.id,
      customerId: customer.id,
      direction: 'INBOUND',
      type: 'TEXT',
      status: 'RECEIVED',
      body: `${mark} said hello`,
    },
  });

  await prisma.order.create({
    data: {
      tenantId,
      customerId: customer.id,
      customerName: `${mark} Customer`,
      deliveryAddress: `${mark} Street`,
      subtotal: '100',
      totalAmount: '100',
    },
  });

  const category = await prisma.menuCategory.create({
    data: { tenantId, name: `${mark} Mains` },
  });
  await prisma.menuItem.create({
    data: { tenantId, categoryId: category.id, name: `${mark} Biryani`, basePrice: '250' },
  });

  await prisma.customerList.create({ data: { tenantId, name: `${mark} regulars` } });

  await prisma.knowledgeEntry.create({
    data: { tenantId, title: `${mark} opening hours`, body: `${mark} is open all day` },
  });

  await prisma.workflow.create({ data: { tenantId, name: `${mark} greeting flow` } });

  await prisma.lead.create({
    data: { tenantId, name: `${mark} Prospect`, phone: `${phoneStem}88` },
  });

  await prisma.ticket.create({
    data: {
      tenantId,
      customerId: customer.id,
      number: `${mark}-1`,
      sequence: 1,
      subject: `${mark} cannot log in`,
      body: `${mark} reported a problem`,
    },
  });

  // `Campaign.templateId` is a real relation, so the template has to exist first — and it is
  // itself a tenant-owned row worth having a sentinel on.
  const template = await prisma.campaignTemplate.create({
    data: {
      tenantId,
      name: `${mark} festival greeting`,
      metaTemplate: `${mark.toLowerCase()}_festival`,
      bodyPreview: `${mark} wishes you a happy Diwali`,
    },
  });
  await prisma.campaign.create({
    data: { tenantId, name: `${mark} Diwali blast`, templateId: template.id },
  });

  await prisma.mediaAsset.create({
    data: {
      tenantId,
      kind: 'IMAGE',
      mimeType: 'image/png',
      sizeBytes: 100,
      originalName: `${mark}-menu.png`,
      storageKey: `${tenantId}/${mark}-menu.png`,
    },
  });

  // Workspace-wide, so it reaches every member of this tenant and nobody else's.
  await prisma.notification.create({
    data: {
      tenantId,
      kind: 'MESSAGE_RECEIVED',
      title: `${mark} Customer sent a message`,
      body: `${mark} said hello`,
      conversationId: conversation.id,
    },
  });

  return {
    tenantId,
    token: signToken({ userId: owner.id }),
    colleagueId: colleague.id,
    customerId: customer.id,
    conversationId: conversation.id,
  };
};

const wipe = async () => {
  await prisma.internalNote.deleteMany({
    where: { conversation: { tenantId: { in: [ALPHA, BRAVO] } } },
  });
  await prisma.tenant.deleteMany({ where: { id: { in: [ALPHA, BRAVO] } } });
};

let alpha: Seeded;
let bravo: Seeded;

beforeAll(async () => {
  await wipe();
  alpha = await seed(ALPHA, '1555801');
  bravo = await seed(BRAVO, '1555802');
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

/**
 * Every tenant-scoped list endpoint an owner can reach.
 *
 * Deliberately only GETs that return rows: this file is about reads leaking, and a write cannot
 * leak what it never returns. `/api/notifications` is included even though it is personal rather
 * than permissioned — a workspace-wide notification is addressed by tenant, so it can leak the
 * same way.
 */
const LIST_ENDPOINTS = [
  '/api/inbox/conversations',
  '/api/customers',
  '/api/customer-lists',
  '/api/orders',
  '/api/catalogue/categories',
  '/api/catalogue/items',
  '/api/knowledge',
  '/api/workflows',
  '/api/roles',
  '/api/team',
  '/api/leads',
  '/api/tickets',
  '/api/campaigns',
  '/api/media',
  '/api/notifications',
] as const;

const get = (path: string, token: string) =>
  request(app).get(path).set('Authorization', `Bearer ${token}`);

describe('a list endpoint returns one workspace’s rows and only that workspace’s', () => {
  it.each(LIST_ENDPOINTS)('%s', async (path) => {
    for (const [mine, theirs] of [[alpha, bravo], [bravo, alpha]] as const) {
      const res = await get(path, mine.token);
      expect(res.status, `${path} as ${SENTINEL[mine.tenantId as keyof typeof SENTINEL]}`).toBe(200);

      const body = JSON.stringify(res.body);
      const own = SENTINEL[mine.tenantId as keyof typeof SENTINEL];
      const other = SENTINEL[theirs.tenantId as keyof typeof SENTINEL];

      // Not vacuous: the endpoint really did return this workspace's row.
      expect(body, `${path} should contain its own ${own}`).toContain(own);
      // The property.
      expect(body, `${path} must not contain ${other}`).not.toContain(other);
    }
  });
});

describe('no session, no tenant, no rows', () => {
  /*
   * The `where: { tenantId: undefined }` guard, as a matrix rather than a spot check.
   *
   * This is the only failure mode that returns *every* workspace's rows rather than the wrong
   * one's, so it is the one worth checking on every endpoint. A 200 here would be the whole
   * database.
   */
  it.each(LIST_ENDPOINTS)('%s refuses an anonymous request', async (path) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain('ALPHAONLY');
    expect(JSON.stringify(res.body)).not.toContain('BRAVOONLY');
  });
});

describe('a token that names another workspace', () => {
  it('**does not read that workspace’s rows**', async () => {
    /*
     * `signToken` already accepts extra claims and nine test sites already pass `tenantId` —
     * where it is currently **ignored**, because `requireAuth` reads the tenant off the user row.
     *
     * So today this passes because the claim does nothing. **After the membership work it will
     * pass for a different reason**: the claim will be used to *select* a membership, no
     * membership will match, and the request will be refused outright. The assertion below is
     * written to hold under both, and the 401 is asserted separately once that lands — a test
     * whose meaning changes should say so rather than quietly start proving something else.
     */
    const forged = signToken({ userId: 'unused', tenantId: BRAVO });
    void forged; // the shape, for the reader — the real case is a *valid* user below.

    const alphaOwner = await prisma.user.findFirstOrThrow({ where: { tenantId: ALPHA } });
    const claimingBravo = signToken({ userId: alphaOwner.id, tenantId: BRAVO });

    const res = await get('/api/customers', claimingBravo);
    const body = JSON.stringify(res.body);

    // Either refused, or answered with Alpha's own rows. Never Bravo's.
    expect(body).not.toContain('BRAVOONLY');
    if (res.status === 200) expect(body).toContain('ALPHAONLY');
  });
});

describe('assigning work to somebody in another workspace', () => {
  /*
   * Seven places ask "is this person in my workspace" with the same predicate and no shared
   * helper. Each one, given a real active user from the *other* workspace, must refuse — the
   * consequence otherwise is a live customer parked with somebody who cannot see them.
   *
   * These are the sites that become `requireActiveMember`, so this is also the regression net
   * for that extraction.
   */

  it('**refuses a conversation assignee from another workspace**', async () => {
    const res = await request(app)
      .post(`/api/inbox/conversations/${alpha.conversationId}/assign`)
      .set('Authorization', `Bearer ${alpha.token}`)
      .send({ agentId: bravo.colleagueId });

    expect(res.status).toBe(400);
    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: alpha.conversationId },
    });
    expect(conversation.assignedAgentId).toBeNull();
  });

  it('**refuses a lead owner from another workspace**', async () => {
    // The dedicated route, behind `leads:assign`. `PATCH /leads/:id` also accepts a body but
    // whitelists its fields and ignores `ownerId` — which is why aiming this at the wrong route
    // returned a cheerful 200 and changed nothing.
    const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId: ALPHA } });
    const res = await request(app)
      .patch(`/api/leads/${lead.id}/owner`)
      .set('Authorization', `Bearer ${alpha.token}`)
      .send({ ownerId: bravo.colleagueId });

    expect(res.status).toBe(400);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).ownerId).toBeNull();
  });

  it('**refuses a ticket assignee from another workspace**', async () => {
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { tenantId: ALPHA } });
    const res = await request(app)
      .patch(`/api/tickets/${ticket.id}/assignee`)
      .set('Authorization', `Bearer ${alpha.token}`)
      .send({ assigneeId: bravo.colleagueId });

    expect(res.status).toBe(400);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).assigneeId)
      .toBeNull();
  });

  it('**refuses a team write aimed at another workspace’s member**', async () => {
    // 404 rather than 400 here, and that is right: a foreign user id must read as "no such
    // member of this workspace", not as a validation problem that confirms the id exists.
    const res = await request(app)
      .patch(`/api/team/${bravo.colleagueId}`)
      .set('Authorization', `Bearer ${alpha.token}`)
      .send({ isActive: false });

    expect(res.status).toBe(404);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: bravo.colleagueId } })).isActive)
      .toBe(true);
  });
});

describe('the seat count that bills and the seat count that blocks', () => {
  it('**agree with each other**', async () => {
    /*
     * `limits.ts` enforces and `billing.controller.ts` displays, with the same predicate written
     * out twice. Asserted against **each other** rather than against a literal, because the
     * failure that matters is the two drifting apart — a workspace told it has room and then
     * refused, or the reverse. Both become one `countSeats` call in the next commit.
     */
    const res = await get('/api/billing/subscription', alpha.token);
    expect(res.status).toBe(200);

    // `consumption`, not `entitlements` — what is being used, against what is allowed.
    const displayed = (res.body as { data: { consumption: { teamMembers: number } } })
      .data.consumption.teamMembers;
    const enforced = await prisma.user.count({ where: { tenantId: ALPHA, isActive: true } });

    expect(displayed).toBe(enforced);
    // And it counts this workspace only — Bravo has the same number of people.
    expect(enforced).toBe(2);
  });
});

describe('notifications reach one workspace', () => {
  it('**a workspace-wide notification does not appear in the other workspace’s bell**', async () => {
    const mine = await get('/api/notifications', alpha.token);
    const theirs = await get('/api/notifications', bravo.token);

    expect(JSON.stringify(mine.body)).toContain('ALPHAONLY');
    expect(JSON.stringify(mine.body)).not.toContain('BRAVOONLY');
    expect(JSON.stringify(theirs.body)).toContain('BRAVOONLY');
    expect(JSON.stringify(theirs.body)).not.toContain('ALPHAONLY');
  });

  it('the unread counts are independent', async () => {
    const mine = await get('/api/notifications/unread-count', alpha.token);
    const theirs = await get('/api/notifications/unread-count', bravo.token);
    expect(mine.body.data.count).toBe(1);
    expect(theirs.body.data.count).toBe(1);
  });
});
