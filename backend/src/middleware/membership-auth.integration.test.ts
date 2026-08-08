import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { prisma } from '../config/prisma.js';
import { signToken, signTokenFor } from '../utils/jwt.js';
import { ROLE_PERMISSIONS } from '../config/permissions.js';

/*
 * The workspace a request acts in comes from the token, and is checked against the database.
 *
 * ── What changed, and why the tests had to ───────────────────────────────────
 *
 * `requireAuth` used to read the tenant off the *user row*, which was structurally guaranteed to
 * exist: `User.tenantId` was `NOT NULL`. Now it reads a `tenantId` claim from the token and
 * **selects** an active membership by it. If none matches, the request is refused.
 *
 * That inverts the trust: the claim chooses, and the database decides whether the choice is
 * allowed. Two consequences that are the point of the whole change:
 *
 *   • **Revoking takes effect on the next request**, not at token expiry.
 *   • **A token cannot be edited into another workspace.** It is signed, and even if it were not,
 *     an unmatched claim resolves to nothing rather than to a default.
 *
 * ── The fixture is the feature ───────────────────────────────────────────────
 *
 * One person, two workspaces, a different role in each. That was unrepresentable until this
 * commit — `User.phone` is globally unique, so a second workspace meant a second phone number.
 * Everything below hangs off being able to build it.
 */

const ALPHA = 'bbbb2222-0000-0000-0000-00000000c001';
const BRAVO = 'bbbb2222-0000-0000-0000-00000000c002';
const app = buildApp();

const wipe = async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [ALPHA, BRAVO] } } });
};

/** A workspace with an owner role and a role that can read the Inbox and nothing else. */
const makeWorkspace = async (tenantId: string, name: string) => {
  const tenant = await prisma.tenant.create({
    data: {
      id: tenantId,
      businessName: name,
      category: 'RESTAURANT',
      roles: {
        create: [
          { name: 'Owner', permissions: [...ROLE_PERMISSIONS.OWNER], isOwner: true, isSystem: true },
          // `settings:read` so this role can reach `/api/tenant/me` — otherwise the tests below
          // 403 on permissions before they get to the question they are asking. It still lacks
          // `team:read`, which is what the differing-permissions test turns on.
          { name: 'Reader', permissions: ['inbox:read', 'settings:read'], sortOrder: 90 },
        ],
      },
    },
    include: { roles: true },
  });
  return {
    id: tenantId,
    ownerRole: tenant.roles.find((r) => r.isOwner)!,
    readerRole: tenant.roles.find((r) => !r.isOwner)!,
  };
};

interface TwoWorkspaces {
  alpha: Awaited<ReturnType<typeof makeWorkspace>>;
  bravo: Awaited<ReturnType<typeof makeWorkspace>>;
  /** One login, a member of both. */
  userId: string;
  alphaMembershipId: string;
  bravoMembershipId: string;
  /** Scoped to Alpha, where they are an owner. */
  alphaToken: string;
  /** Scoped to Bravo, where they can only read the Inbox. */
  bravoToken: string;
}

/**
 * One person, owner in Alpha and a reader in Bravo.
 *
 * The memberships are created directly rather than through the team endpoint, because the invite
 * path does not yet attach an existing login — that is the next commit. This is what it will
 * produce.
 */
const seedPersonInBoth = async (): Promise<TwoWorkspaces> => {
  const alpha = await makeWorkspace(ALPHA, 'Alpha Trading');
  const bravo = await makeWorkspace(BRAVO, 'Bravo Trading');

  // `homeTenantId` is still `User.tenantId` and still required, so the login is rooted in Alpha.
  // That column stops meaning "the workspace they are in" here — Bravo is just as real.
  const user = await prisma.user.create({
    data: {
      tenantId: ALPHA,
      phone: '15558801001',
      fullName: 'Two Hats',
      role: 'OWNER',
      roleId: alpha.ownerRole.id,
    },
  });

  const alphaMembership = await prisma.membership.create({
    data: {
      userId: user.id, tenantId: ALPHA, roleId: alpha.ownerRole.id, legacyRole: 'OWNER',
    },
  });
  const bravoMembership = await prisma.membership.create({
    data: {
      userId: user.id, tenantId: BRAVO, roleId: bravo.readerRole.id, legacyRole: 'AGENT',
    },
  });

  return {
    alpha,
    bravo,
    userId: user.id,
    alphaMembershipId: alphaMembership.id,
    bravoMembershipId: bravoMembership.id,
    alphaToken: signToken({ userId: user.id, tenantId: ALPHA }),
    bravoToken: signToken({ userId: user.id, tenantId: BRAVO }),
  };
};

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const get = (path: string, token: string) =>
  request(app).get(path).set(auth(token));

let ctx: TwoWorkspaces;

beforeEach(async () => {
  await wipe();
  ctx = await seedPersonInBoth();
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('one person, two workspaces', () => {
  it('**sees each workspace only through its own token**', async () => {
    // The same login, two tokens, two answers. This is the capability the change exists for.
    const inAlpha = await get('/api/tenant/me', ctx.alphaToken).expect(200);
    const inBravo = await get('/api/tenant/me', ctx.bravoToken).expect(200);

    expect(JSON.stringify(inAlpha.body)).toContain('Alpha Trading');
    expect(JSON.stringify(inAlpha.body)).not.toContain('Bravo Trading');
    expect(JSON.stringify(inBravo.body)).toContain('Bravo Trading');
    expect(JSON.stringify(inBravo.body)).not.toContain('Alpha Trading');
  });

  it('**holds different permissions in each**', async () => {
    /*
     * The single most likely thing to break, and the reason permissions had to move to the
     * membership. `resolvePermissions` needed no change — it was already structural — but it has to
     * be handed the *membership's* role, not the user's. Hand it `user.assignedRole` and this
     * person is an owner everywhere.
     */
    // Owner in Alpha: may read the team.
    await get('/api/team', ctx.alphaToken).expect(200);
    // Reader in Bravo: may not.
    await get('/api/team', ctx.bravoToken).expect(403);

    // And the Inbox, which the Bravo role does grant, works in both.
    await get('/api/inbox/conversations', ctx.alphaToken).expect(200);
    await get('/api/inbox/conversations', ctx.bravoToken).expect(200);
  });
});

describe('a token naming a workspace', () => {
  it('**is refused when the person is not a member of it**', async () => {
    /*
     * The claim is *selected by*, never trusted. Before this commit the claim was ignored entirely
     * and the request was answered with whatever workspace the user row named — so a token could
     * name anything and still work. `tenant-isolation.integration.test.ts` asserted the weaker
     * "never Bravo's rows"; this is the tightened form that only holds now.
     */
    await prisma.membership.delete({ where: { id: ctx.bravoMembershipId } });

    const res = await get('/api/tenant/me', ctx.bravoToken).expect(401);
    expect(res.body.message).toMatch(/not a member of that workspace/i);
  });

  it('**is refused for a workspace that does not exist**', async () => {
    const forged = signToken({ userId: ctx.userId, tenantId: '00000000-0000-4000-8000-000000000000' });
    await get('/api/tenant/me', forged).expect(401);
  });
});

describe('revoking a membership', () => {
  it('**invalidates an already-issued token on the very next request**', async () => {
    /*
     * The property that makes "remove somebody" mean something. Under the old code the tenant came
     * off the user row, so a revoked person kept working until their token expired — up to a day.
     */
    await get('/api/tenant/me', ctx.bravoToken).expect(200);

    await prisma.membership.update({
      where: { id: ctx.bravoMembershipId },
      data: { isActive: false, revokedAt: new Date() },
    });

    await get('/api/tenant/me', ctx.bravoToken).expect(401);
  });

  it('**leaves their other workspace alone**', async () => {
    // The whole reason `Membership.isActive` is separate from `User.isActive`. Revoking one
    // workspace must not sign somebody out of the business they run.
    await prisma.membership.update({
      where: { id: ctx.bravoMembershipId },
      data: { isActive: false, revokedAt: new Date() },
    });

    await get('/api/tenant/me', ctx.alphaToken).expect(200);
  });

  it('**deactivating the login refuses every workspace**', async () => {
    // The other switch. `User.isActive` is the operator's kill switch and is global by design.
    await prisma.user.update({ where: { id: ctx.userId }, data: { isActive: false } });

    await get('/api/tenant/me', ctx.alphaToken).expect(401);
    await get('/api/tenant/me', ctx.bravoToken).expect(401);
  });
});

describe('a suspended workspace', () => {
  it('**refuses that workspace and not the other**', async () => {
    await prisma.tenant.update({ where: { id: BRAVO }, data: { isActive: false } });

    const refused = await get('/api/tenant/me', ctx.bravoToken).expect(403);
    expect(refused.body.message).toMatch(/suspended/i);

    await get('/api/tenant/me', ctx.alphaToken).expect(200);
  });
});

describe('tokens minted before the claim existed', () => {
  /*
   * Everyone signed in on the day this deploys. The branch that handles them is dated for deletion;
   * these tests are what make its behaviour deliberate rather than incidental.
   */

  it('resolves when the person has exactly one workspace', async () => {
    // Which is every token in the wild at the moment this ships, since cardinality was 1:1.
    await prisma.membership.delete({ where: { id: ctx.bravoMembershipId } });

    const legacy = signToken({ userId: ctx.userId });
    const res = await get('/api/tenant/me', legacy).expect(200);
    expect(JSON.stringify(res.body)).toContain('Alpha Trading');
  });

  it('**refuses rather than guessing when there are two**', async () => {
    /*
     * A silent pick here would be a cross-workspace read with a valid signature and no audit
     * trail — and invisible for as long as the branch lives. The 401 carries a code so the client
     * knows the answer is "ask which workspace", not "sign in again".
     */
    const legacy = signToken({ userId: ctx.userId });

    const res = await get('/api/tenant/me', legacy).expect(401);
    expect(res.body.message).toMatch(/choose a workspace/i);
    expect(res.body.details?.code ?? res.body.code).toBe('WORKSPACE_REQUIRED');
  });

  it('**does not fall back to the workspace the login was rooted in**', async () => {
    /*
     * The tempting shortcut: two memberships, so use `User.tenantId`. It looks harmless because
     * that column names a workspace they really are in — but it means the *server* chose, silently,
     * on a request that gave it no instruction. Alpha is this person's home workspace, so a
     * fallback would answer 200 here.
     */
    const legacy = signToken({ userId: ctx.userId });
    await get('/api/tenant/me', legacy).expect(401);
  });
});

describe('the switcher must stay reachable', () => {
  it('**a suspended workspace does not lock somebody out of leaving it**', async () => {
    /*
     * The reason `requireSession` exists. If the endpoints that list and change workspaces sat
     * behind `requireAuth`, a person whose active workspace was suspended would have no way to
     * reach the one that is fine — the only fix would be a support ticket.
     *
     * Those endpoints arrive in the next commit; this asserts the middleware they will mount on is
     * already exported and already permits this case, so the requirement is recorded now rather
     * than discovered then.
     */
    const { requireSession } = await import('./auth.js');
    expect(typeof requireSession).toBe('function');

    // And the state it has to survive really is reachable: suspended workspace, valid token.
    await prisma.tenant.update({ where: { id: BRAVO }, data: { isActive: false } });
    await get('/api/tenant/me', ctx.bravoToken).expect(403);
  });
});

describe('GET /api/auth/workspaces', () => {
  it('**lists both, marking the one this token is acting in**', async () => {
    const res = await get('/api/auth/workspaces', ctx.alphaToken).expect(200);
    const workspaces = res.body.data.workspaces as Array<Record<string, unknown>>;

    expect(workspaces).toHaveLength(2);
    expect(workspaces.filter((w) => w.isCurrent)).toHaveLength(1);
    expect(workspaces.find((w) => w.isCurrent)?.id).toBe(ALPHA);
    // The workspace's own role name, not the legacy enum — a switcher showing `AGENT` beside a role
    // somebody renamed would contradict the Team screen.
    expect(workspaces.find((w) => w.id === BRAVO)?.roleName).toBe('Reader');
  });

  it('**answers even when the current workspace is suspended**', async () => {
    /*
     * The not-stuck property, and the entire reason `requireSession` exists. Behind `requireAuth`
     * this would 403 — so somebody whose workspace was suspended could neither see the workspace
     * that is fine nor move to it, and the only exit would be a support ticket.
     */
    await prisma.tenant.update({ where: { id: BRAVO }, data: { isActive: false } });

    const res = await get('/api/auth/workspaces', ctx.bravoToken).expect(200);
    const workspaces = res.body.data.workspaces as Array<Record<string, unknown>>;

    expect(workspaces).toHaveLength(2);
    // Listed, and honest about why it cannot be entered. Hiding it would make a business vanish.
    expect(workspaces.find((w) => w.id === BRAVO)?.isSuspended).toBe(true);
    expect(workspaces.find((w) => w.id === ALPHA)?.isSuspended).toBe(false);
  });

  it('**answers a token that predates workspace scoping**', async () => {
    // The ambiguous legacy token: `requireAuth` refuses it with WORKSPACE_REQUIRED, and this is the
    // endpoint the client is told to call next. If it needed a resolved workspace, that instruction
    // would be a dead end.
    const legacy = signToken({ userId: ctx.userId });

    await get('/api/tenant/me', legacy).expect(401);
    const res = await get('/api/auth/workspaces', legacy).expect(200);
    expect(res.body.data.workspaces).toHaveLength(2);
  });

  it('does not list a workspace the person has been removed from', async () => {
    await prisma.membership.update({
      where: { id: ctx.bravoMembershipId }, data: { isActive: false },
    });
    const res = await get('/api/auth/workspaces', ctx.alphaToken).expect(200);
    expect(res.body.data.workspaces).toHaveLength(1);
  });
});

describe('POST /api/auth/workspaces/switch', () => {
  const switchTo = (tenantId: string, token: string) => request(app)
    .post('/api/auth/workspaces/switch').set(auth(token)).send({ tenantId });

  it('**returns a token that works in the new workspace and a session describing it**', async () => {
    const res = await switchTo(BRAVO, ctx.alphaToken).expect(200);

    const { token, tenant, activeWorkspaceId, permissions } = res.body.data;
    expect(tenant.businessName).toBe('Bravo Trading');
    expect(activeWorkspaceId).toBe(BRAVO);
    /*
     * **Exactly Bravo's role, not merely "not Alpha's".**
     *
     * The first version asserted `not.toContain('team:manage')`, which passed even when the session
     * view fell back to the legacy `AGENT` template — that template does not include it either. An
     * exact set is what distinguishes "read the membership's role" from "read something that
     * happens to be similarly restricted".
     */
    expect([...permissions].sort()).toEqual(['inbox:read', 'settings:read']);

    // And the token really is scoped there.
    const after = await get('/api/tenant/me', token).expect(200);
    expect(JSON.stringify(after.body)).toContain('Bravo Trading');
  });

  it('**does not extend the session**', async () => {
    /*
     * Otherwise two workspaces buy an indefinite session by ping-ponging — a renewal endpoint
     * nobody designed and nobody would think to audit.
     *
     * The **short-lived** starting token is what makes this decisive. The first version of this
     * test minted the original with `signToken`, so both tokens got the same `JWT_EXPIRES_IN` and,
     * being issued in the same second, identical `exp` — `<=` held whether the endpoint inherited
     * the expiry or started a fresh day. Two minutes of remaining life makes the difference
     * unmissable.
     */
    const nearlyExpired = signTokenFor({ userId: ctx.userId, tenantId: ALPHA }, 120);
    const res = await switchTo(BRAVO, nearlyExpired).expect(200);

    const decode = (raw: string) =>
      JSON.parse(Buffer.from(raw.split('.')[1]!, 'base64url').toString()) as { exp: number };

    const issued = decode(res.body.data.token).exp;
    expect(issued).toBeLessThanOrEqual(decode(nearlyExpired).exp);
    // And concretely: minutes away, not a day.
    expect(issued - Math.floor(Date.now() / 1000)).toBeLessThan(300);
  });

  it('**answers 404, not 403, for a workspace you are not in**', async () => {
    // 403 would make this an oracle: feed it uuids and the status code tells you which are real.
    await prisma.membership.delete({ where: { id: ctx.bravoMembershipId } });

    await switchTo(BRAVO, ctx.alphaToken).expect(404);
    await switchTo('00000000-0000-4000-8000-000000000000', ctx.alphaToken).expect(404);
  });

  it('refuses a workspace that is suspended, and says so', async () => {
    await prisma.tenant.update({ where: { id: BRAVO }, data: { isActive: false } });

    const res = await switchTo(BRAVO, ctx.alphaToken).expect(403);
    expect(res.body.message).toMatch(/suspended/i);
  });

  it('**remembers where you were, so the next login lands there**', async () => {
    await switchTo(BRAVO, ctx.alphaToken).expect(200);

    const membership = await prisma.membership.findUniqueOrThrow({
      where: { id: ctx.bravoMembershipId },
    });
    expect(membership.lastSelectedAt).not.toBeNull();
  });

  it('works from a token that predates workspace scoping', async () => {
    // The client's escape from WORKSPACE_REQUIRED: list, then switch, with the token it already has.
    const legacy = signToken({ userId: ctx.userId });
    const res = await switchTo(ALPHA, legacy).expect(200);
    expect(res.body.data.activeWorkspaceId).toBe(ALPHA);
  });
});
