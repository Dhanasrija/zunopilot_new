import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { prisma } from '../config/prisma.js';
import { signToken } from '../utils/jwt.js';
import { seedDefaultRoles } from '../services/role.service.js';

/*
 * Who may take a conversation off a colleague.
 *
 * **The bug this file exists for: the check asked the legacy enum, not the role.**
 * `can(actor.role, 'inbox:assign_others')` reads `ROLE_PERMISSIONS[legacyEnum]` — the three
 * built-in templates — so a workspace that built a custom role granting `inbox:assign_others`
 * was refused anyway. The person was told "Ask a manager to reassign it" while *being* the
 * manager, and nothing on screen or in the logs explained it.
 *
 * So every fixture here deliberately sets the legacy enum to `AGENT` while the custom role says
 * otherwise. If the two agreed, the test would pass against the broken code and prove nothing —
 * which is why no existing test caught this: they all use the seeded roles, whose permissions
 * match their enum by construction.
 */

const TENANT = '66666666-6666-6666-6666-66666666a001';
/*
 * A second workspace, with a fixed id and torn down by `wipe`.
 *
 * It used to be created inside the test that needed it and deleted on the line after the
 * assertions — so the first time an assertion failed, the teardown never ran, the row leaked,
 * and every later run died on a unique-phone collision instead of on the real failure. Fixture
 * state has to be cleaned by something that runs whether the test passed or not.
 */
const OUTSIDE = '66666666-6666-6666-6666-66666666a002';
const app = buildApp();

const wipe = async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [TENANT, OUTSIDE] } } });
};

/** A workspace, a conversation already assigned to one agent, and three people. */
const makeWorkspace = async () => {
  await prisma.tenant.create({
    data: { id: TENANT, businessName: 'Assign Co', category: 'RESTAURANT' },
  });
  await seedDefaultRoles(prisma, TENANT);

  /*
   * A custom role, spelled out rather than cloned from a template.
   *
   * `inbox:assign_self` is the route's own gate, so it has to be here or the request never
   * reaches the controller and the test would pass for the wrong reason. `inbox:assign_others`
   * is the permission under test.
   */
  const reassigner = await prisma.role.create({
    data: {
      tenantId: TENANT,
      name: 'Shift lead',
      permissions: ['inbox:read', 'inbox:reply', 'inbox:assign_self', 'inbox:assign_others'],
    },
  });
  /** The same role minus the one permission — the control. */
  const plain = await prisma.role.create({
    data: {
      tenantId: TENANT,
      name: 'Floor agent',
      permissions: ['inbox:read', 'inbox:reply', 'inbox:assign_self'],
    },
  });

  const person = (phone: string, fullName: string, roleId: string) => prisma.user.create({
    data: {
      tenantId: TENANT,
      phone,
      fullName,
      // **AGENT on purpose.** `ROLE_PERMISSIONS.AGENT` does not include `inbox:assign_others`,
      // so the legacy enum says no while the custom role says yes. That disagreement is the
      // whole test.
      role: 'AGENT',
      roleId,
    },
  });

  const lead = await person('15557770001', 'Shift Lead', reassigner.id);
  const agent = await person('15557770002', 'Floor Agent', plain.id);
  const holder = await person('15557770003', 'Busy Colleague', plain.id);

  const customer = await prisma.customer.create({
    data: { tenantId: TENANT, waId: '15557779999', waProfileName: 'Asha' },
  });
  const conversation = await prisma.conversation.create({
    data: {
      tenantId: TENANT,
      customerId: customer.id,
      status: 'OPEN',
      lastMessageAt: new Date(),
      // Already somebody else's, which is what makes this "assign_others" rather than a claim.
      assignedAgentId: holder.id,
    },
  });

  return {
    conversation,
    lead,
    agent,
    holder,
    leadToken: signToken({ userId: lead.id }),
    agentToken: signToken({ userId: agent.id }),
  };
};

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('taking a conversation off a colleague', () => {
  let ctx: Awaited<ReturnType<typeof makeWorkspace>>;

  beforeEach(async () => {
    await wipe();
    ctx = await makeWorkspace();
  });

  afterAll(async () => {
    await wipe();
    await prisma.$disconnect();
  });

  const assign = (token: string, agentId: string | null) => request(app)
    .post(`/api/inbox/conversations/${ctx.conversation.id}/assign`)
    .set(auth(token))
    .send({ agentId });

  const assigneeOf = async () =>
    (await prisma.conversation.findUniqueOrThrow({ where: { id: ctx.conversation.id } }))
      .assignedAgentId;

  it('**honours a custom role that grants inbox:assign_others**', async () => {
    /*
     * The bug. This person's role explicitly carries the permission, and their legacy enum does
     * not — so the old `can(actor.role, …)` check refused them and the new `holds(req, …)` check
     * allows them. Reinstating `can` fails exactly here.
     */
    await assign(ctx.leadToken, ctx.lead.id).expect(200);
    expect(await assigneeOf()).toBe(ctx.lead.id);
  });

  it('**still refuses a custom role that does not grant it**', async () => {
    // The other half. Reading permissions from the real role must not become "allow everyone" —
    // a fix that let anybody reassign would also make the test above pass.
    const res = await assign(ctx.agentToken, ctx.agent.id).expect(403);
    expect(res.body.message).toMatch(/assigned to someone else/i);
    expect(await assigneeOf()).toBe(ctx.holder.id);
  });

  it('refuses handing a colleague’s conversation to a third person', async () => {
    // `givingToSomeoneElse` as well as `takingFromSomeoneElse` — both branches of the same guard.
    await assign(ctx.agentToken, ctx.lead.id).expect(403);
    expect(await assigneeOf()).toBe(ctx.holder.id);
  });

  it('lets anyone claim a conversation nobody holds', async () => {
    // `inbox:assign_self` is the floor, and it is what makes a shared inbox a queue rather than
    // a free-for-all. Unassign first so there is nothing to take from anybody.
    await prisma.conversation.update({
      where: { id: ctx.conversation.id }, data: { assignedAgentId: null },
    });

    await assign(ctx.agentToken, ctx.agent.id).expect(200);
    expect(await assigneeOf()).toBe(ctx.agent.id);
  });

  it('lets someone put their own conversation back without the extra permission', async () => {
    // Releasing your own is neither taking nor giving, so it needs nothing beyond the floor.
    await prisma.conversation.update({
      where: { id: ctx.conversation.id }, data: { assignedAgentId: ctx.agent.id },
    });

    await assign(ctx.agentToken, null).expect(200);
    expect(await assigneeOf()).toBeNull();
  });

  it('refuses an agent from another workspace', async () => {
    // Tenant scoping on the assignee, not just on the conversation — assigning to a stranger
    // would park a live customer where nobody in this workspace can see them.
    await prisma.tenant.create({
      data: { id: OUTSIDE, businessName: 'Elsewhere', category: 'RESTAURANT' },
    });
    const outsider = await prisma.user.create({
      data: { tenantId: OUTSIDE, phone: '15557770009', fullName: 'Outsider', role: 'OWNER' },
    });

    const res = await assign(ctx.leadToken, outsider.id).expect(400);
    // The shared sentence from `requireActiveMember`. This assertion used to match `/agent/i`,
    // against the old `'Invalid agent'` — which named a request field rather than the problem and
    // told the reader nothing to act on. Leads and tickets already said this.
    expect(res.body.message).toMatch(/not an active member of this workspace/i);
    expect(await assigneeOf()).toBe(ctx.holder.id);
  });
});
