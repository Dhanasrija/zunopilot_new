import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { seedMemberships } from '../../test-support/members.js';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { prisma } from '../../config/prisma.js';
import { buildApp } from '../../app.js';
import { buildSuperAdminApp } from '../../superadmin-server.js';
import { signToken } from '../../utils/jwt.js';

// Contact enquiries.
//
// Two things are being protected here. The first is that **an enquiry is never
// lost** — the bug this replaced silently discarded every submission, so the tests
// lean on storing something imperfect over rejecting it. The second is the boundary:
// the write is public by necessity, and the read must be operator-only.

const app = buildApp();
const superAdminApp = buildSuperAdminApp();

const SECRET = 'test-super-admin-secret-at-least-32-characters-long';
const EMAIL = 'enquiries-test@zunopilot.test';
const PASSWORD = 'EnquiryTest123!';
const TENANT = 'aaaaaaaa-d000-0000-0000-000000000001';

let opToken: string;
let tenantToken: string;

const VALID = {
  fullName: 'Priya Sharma',
  email: 'Priya@Example.com',
  dialCode: '+91',
  phone: '7702000350',
  interest: 'Pricing & Plans',
  message: 'We run four salons and want to automate appointment reminders.',
};

const wipe = async () => {
  await prisma.enquiry.deleteMany({ where: { email: { contains: 'example.com' } } });
  await prisma.auditEvent.deleteMany({ where: { action: { startsWith: 'enquiry.' } } });
  await prisma.superAdmin.deleteMany({ where: { email: EMAIL } });
  await prisma.tenant.deleteMany({ where: { id: TENANT } });
};

beforeEach(async () => {
  process.env.SUPERADMIN_JWT_SECRET = SECRET;
  await wipe();

  await prisma.superAdmin.create({
    data: { email: EMAIL, fullName: 'Enquiry Tester', passwordHash: await bcrypt.hash(PASSWORD, 10) },
  });
  const login = await request(superAdminApp)
    .post('/sa/auth/login').send({ email: EMAIL, password: PASSWORD }).expect(200);
  opToken = login.body.data.token;

  const tenant = await prisma.tenant.create({
    data: {
      id: TENANT,
      businessName: 'Boundary Co',
      onboardingCompletedAt: new Date(),
      users: { create: { phone: '15551230001', fullName: 'Owner', role: 'OWNER' } },
    },
    include: { users: true },
  });
  tenantToken = signToken({ userId: tenant.users[0].id });
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const post = (body: Record<string, unknown>) => request(app).post('/api/contact').send(body);

describe('submitting an enquiry', () => {
  it('succeeds without any authentication — the endpoint is public by design', async () => {
    // The person filling in the form has no account and is trying to get one.
    const response = await post(VALID).expect(201);
    expect(response.body.data).toEqual({ received: true });

    const stored = await prisma.enquiry.findFirstOrThrow({ where: { fullName: 'Priya Sharma' } });
    expect(stored.status).toBe('NEW');
    expect(stored.message).toContain('four salons');
  });

  it('keeps the dial code, which the old fake submit dropped entirely', async () => {
    // `country` lives outside the form state, so it has to be sent and joined
    // explicitly. Losing it would leave every stored number un-diallable.
    await post(VALID).expect(201);
    const stored = await prisma.enquiry.findFirstOrThrow({ where: { fullName: 'Priya Sharma' } });
    expect(stored.phone).toBe('917702000350');
  });

  it('lowercases the email so the same person is not two rows', async () => {
    await post(VALID).expect(201);
    const stored = await prisma.enquiry.findFirstOrThrow({ where: { fullName: 'Priya Sharma' } });
    expect(stored.email).toBe('priya@example.com');
  });

  it('**still stores an enquiry whose phone cannot be normalised**', async () => {
    // The single most important behaviour: `normalisePhone` refuses anything
    // outside 8–15 digits, and a prospect who types their number oddly must not be
    // silently dropped. The sales conversation can sort the format out.
    // `+1` + `12345` is six digits — under `normalisePhone`'s eight-digit floor, so
    // it takes the fallback path. Plausibly a typo, and still a lead worth keeping.
    await post({ ...VALID, dialCode: '+1', phone: '12345', email: 'odd@example.com' }).expect(201);
    const stored = await prisma.enquiry.findFirstOrThrow({ where: { email: 'odd@example.com' } });
    expect(stored.phone).toContain('12345');

    // But a genuinely absent phone is still refused — the floor exists for that.
    await post({ ...VALID, phone: '', email: 'blank@example.com' }).expect(400);
  });

  it('records the interest verbatim rather than against an enum', async () => {
    // The options are marketing copy; an enum here would reject an enquiry the day
    // someone added a seventh choice to the page.
    await post({ ...VALID, interest: 'Something we have not thought of', email: 'new@example.com' })
      .expect(201);
    const stored = await prisma.enquiry.findFirstOrThrow({ where: { email: 'new@example.com' } });
    expect(stored.interest).toBe('Something we have not thought of');
  });

  it('rejects a bad email, a missing interest and an over-long message', async () => {
    await post({ ...VALID, email: 'not-an-email' }).expect(400);
    await post({ ...VALID, interest: '' }).expect(400);
    // 1000 is the cap the form's own counter shows the visitor.
    await post({ ...VALID, message: 'x'.repeat(1001) }).expect(400);
    expect(await prisma.enquiry.count({ where: { email: { contains: 'example.com' } } })).toBe(0);
  });

  it('does not echo the submission back or hand out an id', async () => {
    // A public endpoint returning its own input is a reflected-content footgun,
    // and an anonymous caller has no use for the row id.
    const response = await post(VALID).expect(201);
    expect(Object.keys(response.body.data)).toEqual(['received']);
    expect(JSON.stringify(response.body)).not.toContain('Priya');
  });
});

describe('who can read them', () => {
  it('refuses an unauthenticated read', async () => {
    await request(superAdminApp).get('/sa/enquiries').expect(401);
  });

  it('**refuses a valid customer tenant token**', async () => {
    // The boundary that matters. These are ZunoPilot's own prospects; a workspace
    // owner has no business reading them, and this is exactly why they are not
    // tenant `Lead`s.
    await request(superAdminApp).get('/sa/enquiries').set(auth(tenantToken)).expect(401);
  });

  it('is not reachable from the customer API at all', async () => {
    await request(app).get('/api/enquiries').set(auth(tenantToken)).expect(404);
  });

  it('lets an operator read the message body, which is the point of the screen', async () => {
    await post(VALID).expect(201);
    const response = await request(superAdminApp)
      .get('/sa/enquiries').set(auth(opToken)).expect(200);

    const found = response.body.data.enquiries.find((e: { email: string }) => e.email === 'priya@example.com');
    expect(found.message).toContain('four salons');
    expect(response.body.data.counts.NEW).toBeGreaterThanOrEqual(1);
  });
});

describe('handling an enquiry', () => {
  const submit = async () => {
    await post(VALID).expect(201);
    return prisma.enquiry.findFirstOrThrow({ where: { email: 'priya@example.com' } });
  };

  it('records a status change on the audit trail with no tenant', async () => {
    const enquiry = await submit();
    await request(superAdminApp)
      .patch(`/sa/enquiries/${enquiry.id}`).set(auth(opToken))
      .send({ status: 'CONTACTED' }).expect(200);

    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { action: 'enquiry.status_changed' },
    });
    // Platform-level, so there is no workspace to attribute it to — which is why
    // `AuditEvent.tenantId` was left nullable in the first place.
    expect(event.tenantId).toBeNull();
    expect(event.targetId).toBe(enquiry.id);
  });

  it('stamps handledAt once and never moves it', async () => {
    const enquiry = await submit();
    await request(superAdminApp).patch(`/sa/enquiries/${enquiry.id}`).set(auth(opToken))
      .send({ status: 'CONTACTED' }).expect(200);
    const first = (await prisma.enquiry.findUniqueOrThrow({ where: { id: enquiry.id } })).handledAt;
    expect(first).not.toBeNull();

    await request(superAdminApp).patch(`/sa/enquiries/${enquiry.id}`).set(auth(opToken))
      .send({ status: 'CLOSED' }).expect(200);
    const after = (await prisma.enquiry.findUniqueOrThrow({ where: { id: enquiry.id } })).handledAt;
    // "How long did we take to pick this up" has to stay answerable.
    expect(after?.toISOString()).toBe(first?.toISOString());
  });

  it('marks spam without destroying the record', async () => {
    const enquiry = await submit();
    await request(superAdminApp).patch(`/sa/enquiries/${enquiry.id}`).set(auth(opToken))
      .send({ status: 'SPAM' }).expect(200);

    // A status, not a delete: the queue clears but the record of what arrived stays.
    const stored = await prisma.enquiry.findUniqueOrThrow({ where: { id: enquiry.id } });
    expect(stored.status).toBe('SPAM');
    expect(stored.message).toContain('four salons');
  });

  it('saves an internal note without touching the status', async () => {
    const enquiry = await submit();
    await request(superAdminApp).patch(`/sa/enquiries/${enquiry.id}`).set(auth(opToken))
      .send({ internalNote: 'Called, wants a demo Tuesday' }).expect(200);

    const stored = await prisma.enquiry.findUniqueOrThrow({ where: { id: enquiry.id } });
    expect(stored.internalNote).toBe('Called, wants a demo Tuesday');
    expect(stored.status).toBe('NEW');
  });

  it('refuses an empty patch', async () => {
    const enquiry = await submit();
    await request(superAdminApp).patch(`/sa/enquiries/${enquiry.id}`).set(auth(opToken))
      .send({}).expect(400);
  });

  it('404s an unknown enquiry', async () => {
    await request(superAdminApp)
      .patch('/sa/enquiries/aaaaaaaa-d000-0000-0000-0000000000ff').set(auth(opToken))
      .send({ status: 'CLOSED' }).expect(404);
  });
});

describe('the new-enquiry count that drives the nav badge', () => {
  it('counts only unhandled ones', async () => {
    await post(VALID).expect(201);
    await post({ ...VALID, email: 'second@example.com' }).expect(201);

    const before = await request(superAdminApp).get('/sa/overview').set(auth(opToken)).expect(200);
    expect(before.body.data.newEnquiries).toBeGreaterThanOrEqual(2);

    const one = await prisma.enquiry.findFirstOrThrow({ where: { email: 'second@example.com' } });
    await request(superAdminApp).patch(`/sa/enquiries/${one.id}`).set(auth(opToken))
      .send({ status: 'CONTACTED' }).expect(200);

    const after = await request(superAdminApp).get('/sa/overview').set(auth(opToken)).expect(200);
    expect(after.body.data.newEnquiries).toBe(before.body.data.newEnquiries - 1);
  });
});

/*
 * Memberships for the users this fixture inserts directly.
 *
 * In the product every path that creates a user writes a `Membership` too. Fixtures bypass those
 * paths, so without this they produce a login belonging to no workspace — which works while
 * `requireAuth` reads `User.tenantId` and 401s the moment it reads memberships.
 *
 * Registered last in the file so it runs after every fixture hook above, whichever of them created
 * the users. Idempotent. See `test-support/members.ts` for why this is an explicit call rather than
 * a global hook.
 */
beforeEach(async () => { await seedMemberships(); });
