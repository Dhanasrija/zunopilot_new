import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { seedMemberships } from '../../../test-support/members.js';
import request from 'supertest';
import { prisma } from '../../../config/prisma.js';
import { buildApp } from '../../../app.js';
import { signToken } from '../../../utils/jwt.js';
import { ROLE_PERMISSIONS } from '../../../config/permissions.js';

// The connector type catalog, over HTTP.
//
// **This is the first suite to exercise the connector controller at all.** The existing
// `connectors.integration.test.ts` calls `invokeOperation` directly, so nothing until now
// covered the routes, the permission gates, or the promise that a credential never comes
// back out.
//
// The three things that matter most, and the reason each is here:
//
//   • Picking a type clones its operations. Without that, a catalog is a dropdown.
//   • Creating *without* a type behaves exactly as it did before the catalog existed —
//     every caller that predates it, including the suite above, depends on that.
//   • A retired type cannot be used, and an auth type the catalog does not offer is
//     refused. Both are the difference between a catalog and a suggestion.

const app = buildApp();

const TENANT = 'cccccccc-c000-0000-0000-00000000c001';
const OTHER = 'cccccccc-c000-0000-0000-00000000c002';

let owner: string;
let deskUser: string;
let typeId: string;

const wipe = async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [TENANT, OTHER] } } });
  await prisma.connectorType.deleteMany({ where: { key: { startsWith: 'test_' } } });
};

const makeTenant = async (id: string, name: string, base: string) => {
  const tenant = await prisma.tenant.create({
    data: {
      id,
      businessName: name,
      category: 'RESTAURANT',
      roles: {
        create: [
          { name: 'Owner', permissions: [...ROLE_PERMISSIONS.OWNER], isOwner: true, isSystem: true },
          // A role that may read customers but was deliberately built without any connector
          // access. Before this change the connector GETs ignored the permission entirely,
          // so this role could still read every base URL and credential hint.
          { name: 'Front desk', permissions: ['customers:read'], sortOrder: 40 },
        ],
      },
      users: {
        create: [
          { phone: `${base}1`, fullName: 'Owner', role: 'OWNER' },
          { phone: `${base}2`, fullName: 'Desk', role: 'AGENT' },
        ],
      },
    },
    include: { users: { orderBy: { phone: 'asc' } }, roles: true },
  });

  const ownerRole = tenant.roles.find((r) => r.isOwner)!;
  const deskRole = tenant.roles.find((r) => !r.isOwner)!;
  await prisma.user.update({ where: { id: tenant.users[0].id }, data: { roleId: ownerRole.id } });
  await prisma.user.update({ where: { id: tenant.users[1].id }, data: { roleId: deskRole.id } });

  return {
    ownerToken: signToken({ userId: tenant.users[0].id }),
    deskToken: signToken({ userId: tenant.users[1].id }),
  };
};

/** A catalog entry with one plain operation and one that changes data. */
const makeType = async (overrides: Record<string, unknown> = {}) => {
  const type = await prisma.connectorType.create({
    data: {
      key: 'test_payments',
      label: 'Test Payments',
      kind: 'HTTP',
      allowedAuthTypes: ['BASIC'],
      defaultBaseUrl: 'https://api.example.com/v1',
      usernameLabel: 'Key ID',
      secretLabel: 'Key Secret',
      operationTemplates: {
        create: [
          {
            key: 'fetch_payment',
            name: 'Fetch a payment',
            method: 'GET',
            path: '/payments/{payment_id}',
            inputs: [{ key: 'payment_id', label: 'Payment id', type: 'string', required: true, in: 'path' }],
            responseMapping: { itemsPath: '', idField: 'id', titleField: 'status' },
            sortOrder: 10,
          },
          {
            key: 'create_refund',
            name: 'Refund a payment',
            method: 'POST',
            path: '/payments/{payment_id}/refund',
            sideEffecting: true,
            sortOrder: 20,
          },
        ],
      },
      ...overrides,
    },
  });
  return type.id;
};

beforeEach(async () => {
  await wipe();
  const mine = await makeTenant(TENANT, 'Catalog Test', '1555c10000');
  owner = mine.ownerToken;
  deskUser = mine.deskToken;
  typeId = await makeType();
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const create = (token: string, body: Record<string, unknown>) =>
  request(app).post('/api/connectors').set(auth(token)).send(body);

const base = {
  key: 'payments',
  name: 'Payments',
  authType: 'BASIC',
  authConfig: { username: 'rzp_test_abc' },
  secret: 'super-secret-value',
};

describe('the catalog, as a tenant sees it', () => {
  it('offers the active types with their operation templates', async () => {
    const response = await request(app).get('/api/connectors/types').set(auth(owner)).expect(200);
    const type = response.body.data.find((t: { key: string }) => t.key === 'test_payments');
    expect(type.label).toBe('Test Payments');
    expect(type.defaultBaseUrl).toBe('https://api.example.com/v1');
    // The picker needs the field names to show "Key ID" rather than "Username".
    expect(type.secretLabel).toBe('Key Secret');
    expect(type.operationTemplates.map((o: { key: string }) => o.key))
      .toEqual(['fetch_payment', 'create_refund']);
  });

  it('**hides a retired type**, so the form never offers a choice the API would reject', async () => {
    await prisma.connectorType.update({ where: { id: typeId }, data: { isActive: false } });
    const response = await request(app).get('/api/connectors/types').set(auth(owner)).expect(200);
    expect(response.body.data.map((t: { key: string }) => t.key)).not.toContain('test_payments');
  });

  it('resolves /types ahead of /:connectorId', async () => {
    // Express would otherwise read "types" as a connector id and 404 the whole endpoint.
    await request(app).get('/api/connectors/types').set(auth(owner)).expect(200);
  });
});

describe('creating a connector from a type', () => {
  it('**clones the operations**, so the connector is usable immediately', async () => {
    const response = await create(owner, { ...base, connectorTypeId: typeId }).expect(201);

    expect(response.body.data.connectorTypeId).toBe(typeId);
    expect(response.body.data.operations.map((o: { key: string }) => o.key).sort())
      .toEqual(['create_refund', 'fetch_payment']);

    // Copied faithfully, not translated — the template shape *is* the runtime shape.
    const fetchOp = response.body.data.operations.find((o: { key: string }) => o.key === 'fetch_payment');
    expect(fetchOp.method).toBe('GET');
    expect(fetchOp.path).toBe('/payments/{payment_id}');
    expect(fetchOp.inputs).toEqual([
      { key: 'payment_id', label: 'Payment id', type: 'string', required: true, in: 'path' },
    ]);

    const refund = response.body.data.operations.find((o: { key: string }) => o.key === 'create_refund');
    // Carried across, because it drives the rule that a side-effecting workflow must
    // confirm first and stops "Test" issuing a real refund.
    expect(refund.sideEffecting).toBe(true);
  });

  it('takes the base URL from the type when the tenant does not supply one', async () => {
    const response = await create(owner, { ...base, connectorTypeId: typeId }).expect(201);
    expect(response.body.data.baseUrl).toBe('https://api.example.com/v1');
  });

  it('**lets the tenant override the base URL** — creation stays in their hands', async () => {
    const response = await create(owner, {
      ...base, connectorTypeId: typeId, baseUrl: 'https://api.example.com/v2',
    }).expect(201);
    expect(response.body.data.baseUrl).toBe('https://api.example.com/v2');
  });

  it('still refuses a base URL the egress guard blocks, type or no type', async () => {
    const response = await create(owner, {
      ...base, connectorTypeId: typeId, baseUrl: 'http://169.254.169.254/latest/meta-data/',
    }).expect(400);
    expect(response.body.message).toBeTruthy();
  });

  it('refuses an auth type the catalog does not offer', async () => {
    const response = await create(owner, {
      ...base, connectorTypeId: typeId, authType: 'BEARER', secret: 'tok',
    }).expect(400);
    expect(response.body.message).toMatch(/does not use BEARER/);
  });

  it('**refuses a retired type**, and says it is retired rather than missing', async () => {
    await prisma.connectorType.update({ where: { id: typeId }, data: { isActive: false } });
    const response = await create(owner, { ...base, connectorTypeId: typeId }).expect(400);
    expect(response.body.message).toMatch(/no longer offered/);
  });

  it('404s a well-formed type id that does not exist', async () => {
    // A valid v4 uuid, so this reaches the lookup rather than being turned away by Zod.
    await create(owner, { ...base, connectorTypeId: '99999999-9999-4999-8999-999999999999' })
      .expect(404);
  });

  it('400s an id that is not a uuid at all, before any lookup', async () => {
    await create(owner, { ...base, connectorTypeId: 'not-a-uuid' }).expect(400);
  });

  it('never returns the credential, only a masked hint', async () => {
    const response = await create(owner, { ...base, connectorTypeId: typeId }).expect(201);
    expect(JSON.stringify(response.body)).not.toContain('super-secret-value');
    expect(response.body.data.secret.hint).toBe('••••alue');
  });

  it('offers every auth type when the catalog entry has no opinion', async () => {
    // An empty `allowedAuthTypes` is how a generic HTTP type says "whatever your API needs".
    const anyAuth = await prisma.connectorType.create({
      data: { key: 'test_any', label: 'Anything', kind: 'HTTP', allowedAuthTypes: [] },
    });
    await create(owner, {
      ...base, connectorTypeId: anyAuth.id, authType: 'BEARER', secret: 'tok',
      baseUrl: 'https://api.example.com',
    }).expect(201);
  });
});

describe('creating a connector without a type', () => {
  it('**behaves exactly as it did before the catalog existed**', async () => {
    // Every caller that predates the catalog takes this path, including the suite that
    // calls `invokeOperation` directly. If this breaks, the additive claim was false.
    const response = await create(owner, {
      key: 'legacy',
      name: 'Legacy',
      kind: 'HTTP',
      baseUrl: 'https://api.example.com',
      authType: 'NONE',
    }).expect(201);

    expect(response.body.data.connectorTypeId).toBeNull();
    expect(response.body.data.operations).toEqual([]);
  });

  it('still requires a base URL for an HTTP connector', async () => {
    const response = await create(owner, {
      key: 'nourl', name: 'No URL', kind: 'HTTP', authType: 'NONE',
    }).expect(400);
    expect(response.body.message).toMatch(/needs a base URL/);
  });
});

describe('who may read connectors', () => {
  it('**403s a role that holds no connector permission**', async () => {
    // `connectors:read` was in the vocabulary from the start but never enforced, so this
    // role could read every base URL and credential hint in the workspace.
    await request(app).get('/api/connectors').set(auth(deskUser)).expect(403);
    await request(app).get('/api/connectors/types').set(auth(deskUser)).expect(403);
  });

  it('lets the owner read them', async () => {
    await request(app).get('/api/connectors').set(auth(owner)).expect(200);
  });

  it('needs authentication at all', async () => {
    await request(app).get('/api/connectors/types').expect(401);
  });
});

describe('a type that is in use', () => {
  it('**keeps the connector working when the type is deleted**', async () => {
    // The foreign key is SET NULL, not CASCADE. A connector losing its provenance is
    // untidy; a connector disappearing because an operator tidied the catalog is an outage.
    const created = await create(owner, { ...base, connectorTypeId: typeId }).expect(201);
    await prisma.connectorType.delete({ where: { id: typeId } });

    const after = await prisma.connector.findUnique({
      where: { id: created.body.data.id },
      include: { operations: true, secret: true },
    });
    expect(after).not.toBeNull();
    expect(after!.connectorTypeId).toBeNull();
    expect(after!.operations).toHaveLength(2);
    expect(after!.secret).not.toBeNull();
  });

  it('does not re-sync a later template change into an existing connector', async () => {
    // The clone is a one-time snapshot. A tenant may have edited their copy, and silently
    // overwriting it would change what their published workflows call.
    const created = await create(owner, { ...base, connectorTypeId: typeId }).expect(201);
    await prisma.connectorTypeOperation.updateMany({
      where: { connectorTypeId: typeId, key: 'fetch_payment' },
      data: { path: '/v9/completely-different' },
    });

    const ops = await prisma.connectorOperation.findMany({
      where: { connectorId: created.body.data.id, key: 'fetch_payment' },
    });
    expect(ops[0]!.path).toBe('/payments/{payment_id}');
  });
});

describe('editing a connector without resetting what you did not send', () => {
  // These pin a bug that was live before the catalog existed: `connectorUpdateSchema` was
  // `connectorCreateSchema.partial()`, and **Zod's `.partial()` does not suppress
  // `.default()`**. An absent key parsed to its creation default, so every
  // `!== undefined` guard in the handler was true and a rename rewrote three other fields.

  const patch = (id: string, body: Record<string, unknown>) =>
    request(app).patch(`/api/connectors/${id}`).set(auth(owner)).send(body);

  it('**a rename does not silently drop the credential**', async () => {
    // The worst version of the bug: `authType` reset to NONE, so the connector stopped
    // sending its bearer token. Every call then failed at the far end while the encrypted
    // secret sat in the database looking perfectly configured.
    const created = await create(owner, {
      key: 'bearer_api',
      name: 'Bearer API',
      kind: 'HTTP',
      baseUrl: 'https://api.example.com',
      authType: 'BEARER',
      secret: 'a-real-token',
    }).expect(201);

    await patch(created.body.data.id, { name: 'Renamed' }).expect(200);

    const after = await prisma.connector.findUnique({ where: { id: created.body.data.id } });
    expect(after!.name).toBe('Renamed');
    expect(after!.authType).toBe('BEARER');
  });

  it('a rename does not turn a fixture connector into an HTTP one', async () => {
    const created = await create(owner, {
      key: 'acme_lms', name: 'Acme LMS', kind: 'MOCK', authType: 'NONE',
    }).expect(201);

    // This used to 400: the reset `HTTP` kind reached `checkBaseUrl`, and a MOCK connector
    // has no base URL by design.
    await patch(created.body.data.id, { name: 'Acme LMS v2' }).expect(200);

    const after = await prisma.connector.findUnique({ where: { id: created.body.data.id } });
    expect(after!.kind).toBe('MOCK');
    expect(after!.baseUrl).toBeNull();
  });

  it('a rename keeps the API key header name', async () => {
    const created = await create(owner, {
      key: 'keyed',
      name: 'Keyed',
      kind: 'HTTP',
      baseUrl: 'https://api.example.com',
      authType: 'API_KEY_HEADER',
      authConfig: { header: 'X-Acme-Key' },
      secret: 'k',
    }).expect(201);

    await patch(created.body.data.id, { name: 'Keyed again' }).expect(200);

    const after = await prisma.connector.findUnique({ where: { id: created.body.data.id } });
    expect(after!.authConfig).toEqual({ header: 'X-Acme-Key' });
  });

  it('still applies the fields that were sent', async () => {
    // The fix must not go the other way and start ignoring real edits.
    const created = await create(owner, {
      key: 'editable', name: 'Editable', kind: 'HTTP',
      baseUrl: 'https://api.example.com', authType: 'NONE',
    }).expect(201);

    await patch(created.body.data.id, {
      baseUrl: 'https://api.example.com/v2', status: 'DISABLED',
    }).expect(200);

    const after = await prisma.connector.findUnique({ where: { id: created.body.data.id } });
    expect(after!.baseUrl).toBe('https://api.example.com/v2');
    expect(after!.status).toBe('DISABLED');
  });
});

describe('the request payload on an operation', () => {
  const newConnector = () => create(owner, {
    key: 'payapi', name: 'Pay API', kind: 'HTTP',
    baseUrl: 'https://api.example.com', authType: 'NONE',
  }).expect(201);

  const addOp = (connectorId: string, body: Record<string, unknown>) =>
    request(app).post(`/api/connectors/${connectorId}/operations`).set(auth(owner)).send(body);

  const declared = [
    { key: 'amount', label: 'Amount', type: 'number', required: true, in: 'body' },
  ];

  it('stores a payload and returns it', async () => {
    const c = await newConnector();
    const response = await addOp(c.body.data.id, {
      key: 'refund',
      name: 'Refund',
      method: 'POST',
      path: '/refunds',
      inputs: declared,
      bodyTemplate: { amount: '{amount}', currency: 'INR' },
    }).expect(201);
    expect(response.body.data.bodyTemplate).toEqual({ amount: '{amount}', currency: 'INR' });
  });

  it('**refuses a placeholder that names no declared input**', async () => {
    // It could never be filled, so the operation would fail on its first real call. Saying
    // which one is missing is the difference between obvious and a puzzle.
    const c = await newConnector();
    const response = await addOp(c.body.data.id, {
      key: 'refund', name: 'Refund', method: 'POST', path: '/refunds',
      inputs: declared,
      bodyTemplate: { amount: '{amount}', note: '{reason}' },
    }).expect(400);
    expect(response.body.message).toMatch(/uses reason/);
  });

  it('refuses a payload on a method that sends no body', async () => {
    const c = await newConnector();
    const response = await addOp(c.body.data.id, {
      key: 'lookup', name: 'Lookup', method: 'GET', path: '/payments',
      bodyTemplate: { q: 'x' },
    }).expect(400);
    expect(response.body.message).toMatch(/sends no body/);
  });

  it('refuses a payload that is not JSON at all', async () => {
    const c = await newConnector();
    // Sent as a raw string rather than an object — `z.unknown()` accepts it, so the guard
    // that matters is the schema being stored parsed. A string has no placeholders and no
    // shape, and is not a body.
    const response = await addOp(c.body.data.id, {
      key: 'bad', name: 'Bad', method: 'POST', path: '/x',
      bodyTemplate: '{ not json',
    }).expect(201);
    // Accepted as a JSON string value, which is a legitimate body for an API that wants one.
    expect(response.body.data.bodyTemplate).toBe('{ not json');
  });

  it('allows a constant-only payload with no inputs at all', async () => {
    const c = await newConnector();
    await addOp(c.body.data.id, {
      key: 'ping', name: 'Ping', method: 'POST', path: '/ping',
      bodyTemplate: { source: 'zunopilot' },
    }).expect(201);
  });

  it('re-checks on update against the stored inputs', async () => {
    const c = await newConnector();
    const op = await addOp(c.body.data.id, {
      key: 'refund', name: 'Refund', method: 'POST', path: '/refunds', inputs: declared,
    }).expect(201);

    // Only the payload is sent. The inputs it must match are the stored ones.
    const bad = await request(app)
      .patch(`/api/connectors/${c.body.data.id}/operations/${op.body.data.id}`)
      .set(auth(owner))
      .send({ bodyTemplate: { note: '{nope}' } })
      .expect(400);
    expect(bad.body.message).toMatch(/uses nope/);

    await request(app)
      .patch(`/api/connectors/${c.body.data.id}/operations/${op.body.data.id}`)
      .set(auth(owner))
      .send({ bodyTemplate: { amount: '{amount}' } })
      .expect(200);
  });

  it('**renaming an operation does not wipe its inputs or its side-effect flag**', async () => {
    // The third instance of the `.partial()`-over-`.default()` bug, and the most destructive:
    // a PATCH of just the name used to write `inputs: []`, `path: '/'`, `method: 'GET'` and
    // `sideEffecting: false` — erasing the parameter list every workflow node depends on and
    // removing the confirm-first protection from a destructive call.
    const c = await newConnector();
    const op = await addOp(c.body.data.id, {
      key: 'refund',
      name: 'Refund',
      method: 'POST',
      path: '/payments/{payment_id}/refund',
      inputs: [
        { key: 'payment_id', label: 'Payment', type: 'string', required: true, in: 'path' },
        ...declared,
      ],
      sideEffecting: true,
    }).expect(201);

    await request(app)
      .patch(`/api/connectors/${c.body.data.id}/operations/${op.body.data.id}`)
      .set(auth(owner))
      .send({ name: 'Refund a payment' })
      .expect(200);

    const after = await prisma.connectorOperation.findUniqueOrThrow({
      where: { id: op.body.data.id },
    });
    expect(after.name).toBe('Refund a payment');
    expect(after.method).toBe('POST');
    expect(after.path).toBe('/payments/{payment_id}/refund');
    expect((after.inputs as unknown[]).length).toBe(2);
    expect(after.sideEffecting).toBe(true);
  });

  it('carries the payload through a catalog clone', async () => {
    // Otherwise a catalog POST operation arrives at the tenant without its body.
    await prisma.connectorTypeOperation.updateMany({
      where: { connectorTypeId: typeId, key: 'create_refund' },
      data: {
        inputs: [{ key: 'payment_id', label: 'Payment', type: 'string', required: true, in: 'path' }],
        bodyTemplate: { speed: 'normal', reference: '{payment_id}' },
      },
    });

    const created = await create(owner, { ...base, connectorTypeId: typeId }).expect(201);
    const cloned = created.body.data.operations.find((o: { key: string }) => o.key === 'create_refund');
    expect(cloned.bodyTemplate).toEqual({ speed: 'normal', reference: '{payment_id}' });
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
