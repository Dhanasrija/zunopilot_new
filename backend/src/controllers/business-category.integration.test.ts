import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { seedMemberships } from '../test-support/members.js';
import { prisma } from '../config/prisma.js';
import { buildApp } from '../app.js';
import { signToken } from '../utils/jwt.js';
import { ROLE_PERMISSIONS } from '../config/permissions.js';

/*
 * Which category a workspace is, chosen from the table.
 *
 * ── The bug this is the net for, which appeared four times ───────────────────
 *
 * `Tenant.category` is the `BusinessCategoryLegacy` enum, from before categories became rows an
 * operator manages. Nothing has written it since, so it reads `RESTAURANT` for every workspace on
 * the platform — and each surface that displayed or wrote it inherited that: the operator console's
 * workspace list, its detail page, the assistant's own prompt, and the Settings form, which offered a
 * hardcoded pair of options and saved into that dead column.
 *
 * So the property worth pinning is not "the enum is gone" — it stays, as the record of what a
 * workspace was created as. It is that **the id is what gets written and read**, and that a category
 * which does not exist cannot be stored.
 */

const app = buildApp();

const TENANT = 'eeeeeeee-0000-0000-0000-0000000000c1';
const CATEGORY_A = 'eeeeeeee-0000-0000-0000-0000000000c2';
const CATEGORY_OFF = 'eeeeeeee-0000-0000-0000-0000000000c3';

let token: string;

const wipe = async () => {
  await prisma.tenant.deleteMany({ where: { id: TENANT } });
  await prisma.businessCategory.deleteMany({ where: { id: { in: [CATEGORY_A, CATEGORY_OFF] } } });
};

beforeEach(async () => {
  await wipe();

  await prisma.businessCategory.createMany({
    data: [
      { id: CATEGORY_A, key: `CAT_TEST_A_${Date.now()}`, label: 'Cabinet Making', sortOrder: 10 },
      /*
       * Deactivated rather than deleted, which is how a category is retired: workspaces already on it
       * keep working, and new signups stop being offered it. A page that listed this one would offer
       * a choice the operator has withdrawn.
       */
      {
        id: CATEGORY_OFF,
        key: `CAT_TEST_OFF_${Date.now()}`,
        label: 'Retired Trade',
        isActive: false,
      },
    ],
  });

  const tenant = await prisma.tenant.create({
    data: {
      id: TENANT,
      businessName: 'Category Test Co',
      // The legacy enum, as every real row has it — and deliberately *not* what anything below reads.
      category: 'RESTAURANT',
      roles: {
        create: [{
          name: 'Owner', permissions: [...ROLE_PERMISSIONS.OWNER], isOwner: true, isSystem: true,
        }],
      },
      users: { create: [{ phone: '15558803001', fullName: 'Owner', role: 'OWNER' }] },
    },
    include: { roles: true, users: true },
  });
  await prisma.user.update({
    where: { id: tenant.users[0]!.id }, data: { roleId: tenant.roles[0]!.id },
  });
  await seedMemberships();
  token = signToken({ userId: tenant.users[0]!.id, tenantId: TENANT });
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

const patch = (body: Record<string, unknown>) => request(app)
  .patch('/api/tenant/me').set('Authorization', `Bearer ${token}`).send(body);

describe('choosing a business category', () => {
  it('**offers only the active ones, and needs no session**', async () => {
    // The same endpoint the onboarding form uses, which is why it is public: somebody filling in the
    // profile for the first time has a session, but the marketing site's signup does not.
    const res = await request(app).get('/api/auth/business-categories').expect(200);

    const ids = res.body.data.map((c: { id: string }) => c.id);
    expect(ids).toContain(CATEGORY_A);
    expect(ids).not.toContain(CATEGORY_OFF);
  });

  it('**saves the id, and leaves the legacy enum alone**', async () => {
    await patch({ businessCategoryId: CATEGORY_A }).expect(200);

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: TENANT } });
    expect(tenant.businessCategoryId).toBe(CATEGORY_A);
    // Untouched: it is the record of what this workspace was created as, and rewriting it is how the
    // console came to report eleven restaurants.
    expect(tenant.category).toBe('RESTAURANT');
  });

  it('**refuses a category that does not exist**', async () => {
    /*
     * A uuid is guessable and this field is not a foreign key on the way in — Prisma would accept any
     * id shape and fail at the constraint, or worse store a dangling one the app then reads as
     * "not set". Refusing at the edge is what makes "not set" mean what it says.
     */
    const res = await patch({ businessCategoryId: 'eeeeeeee-0000-0000-0000-00000000ffff' })
      .expect(400);
    expect(res.body.message).toMatch(/does not exist/i);

    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: TENANT } })).businessCategoryId)
      .toBeNull();
  });

  it('refuses one an operator has retired', async () => {
    // Deactivating is how a category is withdrawn; accepting it here would let a workspace pick what
    // the picker no longer offers.
    await patch({ businessCategoryId: CATEGORY_OFF }).expect(400);
  });

  it('**can be cleared, which is what "not set" is**', async () => {
    await patch({ businessCategoryId: CATEGORY_A }).expect(200);
    await patch({ businessCategoryId: null }).expect(200);

    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: TENANT } })).businessCategoryId)
      .toBeNull();
  });

  it('leaves the category alone when the request does not mention it', async () => {
    // The Settings form sends the whole profile on every save; a rename must not clear the category
    // as a side effect, and `undefined` has to be distinguishable from `null`.
    await patch({ businessCategoryId: CATEGORY_A }).expect(200);
    await patch({ businessName: 'Renamed Co' }).expect(200);

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: TENANT } });
    expect(tenant.businessName).toBe('Renamed Co');
    expect(tenant.businessCategoryId).toBe(CATEGORY_A);
  });

  it('**saves when the optional URL fields are blank**', async () => {
    /*
     * The bug this page had, found by trying to use the category picker: **Save Changes returned 400
     * for any workspace without a logo.**
     *
     * The form sends the whole profile on every save, so a workspace with no logo sent
     * `logoUrl: ''` — and `.optional()` treats only `undefined` as absent, so `isURL('')` failed.
     * The message named a field the person had not touched, and nothing on the page could be saved
     * at all. Most workspaces have no logo.
     */
    await patch({
      businessName: 'Category Test Co',
      businessCategoryId: CATEGORY_A,
      contactNumber: '+919999999999',
      address: '1 Test Street',
      website: '',
      logoUrl: '',
    }).expect(200);

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: TENANT } });
    expect(tenant.businessCategoryId).toBe(CATEGORY_A);
    // Blank means cleared, stored as null — an empty string would be a value every reader has to
    // guard against, and `<img src="">` re-requests the page in some browsers.
    expect(tenant.website).toBeNull();
    expect(tenant.logoUrl).toBeNull();
  });

  it('still refuses a URL that is present and wrong', async () => {
    // The looser rule must not become no rule: a typo is still a typo.
    await patch({ website: 'not-a-url' }).expect(400);
  });

  it('**is reported back on the profile the Settings form reads**', async () => {
    await patch({ businessCategoryId: CATEGORY_A }).expect(200);

    const res = await request(app).get('/api/tenant/me')
      .set('Authorization', `Bearer ${token}`).expect(200);

    // The form binds its `Select` to this, so a missing field would show an empty control for a
    // workspace that has chosen.
    expect(res.body.data.businessCategoryId).toBe(CATEGORY_A);
  });
});
