import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import { invokeOperation, ConnectorError, readPath } from './invoke.js';
import { encryptSecret, decryptSecret, maskSecret, resetKeyCache } from '../../../config/crypto.js';

// Connector invocation against real Postgres, using the MOCK kind so nothing
// leaves the process.

const TEST_TENANT = '77777777-7777-7777-7777-777777777777';

const wipe = () => prisma.tenant.deleteMany({ where: { id: TEST_TENANT } });

const seedConnector = async (overrides: Partial<Prisma.ConnectorUncheckedCreateInput> = {}) => {
  await prisma.tenant.create({
    data: { id: TEST_TENANT, businessName: 'Connector Test', category: 'RESTAURANT' },
  });

  return prisma.connector.create({
    data: {
      tenantId: TEST_TENANT,
      key: 'acme_lms',
      name: 'Acme LMS',
      kind: 'MOCK',
      authType: 'NONE',
      operations: {
        create: [
          {
            key: 'find_parent_by_phone',
            name: 'Find parent',
            method: 'GET',
            path: '/parents/lookup',
            inputs: [{ key: 'phone', label: 'Phone', type: 'string', required: true, in: 'query' }] as unknown as Prisma.InputJsonValue,
            responseMapping: { itemsPath: '', idField: 'id', titleField: 'name' } as unknown as Prisma.InputJsonValue,
          },
          {
            key: 'list_students',
            name: 'List students',
            method: 'GET',
            path: '/parents/{parent_id}/students',
            inputs: [{ key: 'parent_id', label: 'Parent', type: 'string', required: true, in: 'path' }] as unknown as Prisma.InputJsonValue,
            responseMapping: {
              itemsPath: 'students', idField: 'id', titleField: 'name', descriptionField: 'grade',
            } as unknown as Prisma.InputJsonValue,
          },
          {
            key: 'cancel_class',
            name: 'Cancel a class',
            method: 'POST',
            path: '/classes/{class_id}/cancel',
            inputs: [{ key: 'class_id', label: 'Class', type: 'string', required: true, in: 'path' }] as unknown as Prisma.InputJsonValue,
            responseMapping: {} as unknown as Prisma.InputJsonValue,
            sideEffecting: true,
            sampleResponse: { cancelled: true, reference: 'CAN-SAMPLE' } as unknown as Prisma.InputJsonValue,
          },
        ],
      },
      ...overrides,
    },
  });
};

beforeEach(async () => {
  await wipe();
  await seedConnector();
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

const invoke = (operationKey: string, inputs: Record<string, unknown>, extra = {}) =>
  invokeOperation({ tenantId: TEST_TENANT, connectorKey: 'acme_lms', operationKey, inputs, ...extra });

describe('invoking an operation', () => {
  it('calls the fixture and returns the body', async () => {
    const result = await invoke('find_parent_by_phone', { phone: '15550007001' });
    expect(result.ok).toBe(true);
    expect(result.body).toMatchObject({ registered: true, parent: { id: 'P-1001' } });
  });

  it('normalises a list into rows using the operation\'s own mapping', async () => {
    const result = await invoke('list_students', { parent_id: 'P-1001' });
    expect(result.items.map(({ raw, ...row }) => row)).toEqual([
      { id: 'S-2001', title: 'Ishaan Sharma', description: 'Grade 6' },
      { id: 'S-2002', title: 'Meera Sharma', description: 'Grade 3' },
    ]);
  });

  it('reports a not-found as a non-ok result rather than throwing', async () => {
    // "This number is not a registered parent" is a branch of the conversation,
    // not an exception. Throwing would collapse it into a generic failure.
    const result = await invoke('find_parent_by_phone', { phone: '15559990000' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });

  it('refuses when a required input is missing', async () => {
    await expect(invoke('list_students', {})).rejects.toMatchObject({ code: 'MISSING_INPUT' });
  });

  it('refuses an operation the connector does not declare', async () => {
    await expect(invoke('delete_everything', {})).rejects.toMatchObject({ code: 'UNKNOWN_OPERATION' });
  });

  it('refuses a connector that is disabled', async () => {
    await prisma.connector.updateMany({ where: { tenantId: TEST_TENANT }, data: { status: 'DISABLED' } });
    await expect(invoke('find_parent_by_phone', { phone: '15550007001' }))
      .rejects.toMatchObject({ code: 'CONNECTOR_DISABLED' });
  });

  it('is scoped to the tenant', async () => {
    await expect(invokeOperation({
      tenantId: '00000000-0000-0000-0000-0000000000ff',
      connectorKey: 'acme_lms',
      operationKey: 'find_parent_by_phone',
      inputs: { phone: '15550007001' },
    })).rejects.toMatchObject({ code: 'UNKNOWN_CONNECTOR' });
  });

  it('returns the recorded sample on a dry run, and does not call the far end', async () => {
    // The simulator must never cancel a real class to show what the node does.
    const result = await invoke('cancel_class', { class_id: 'C-3001' }, { dryRun: true });
    expect(result.body).toMatchObject({ reference: 'CAN-SAMPLE' });
    expect(await prisma.connectorCall.count({ where: { tenantId: TEST_TENANT } })).toBe(0);
  });

  it('writes an audit row without request or response bodies', async () => {
    await invoke('find_parent_by_phone', { phone: '15550007001' });
    const [call] = await prisma.connectorCall.findMany({ where: { tenantId: TEST_TENANT } });
    expect(call).toMatchObject({ status: 'SUCCESS', httpStatus: 200 });
    // Nothing on the row can carry a credential or a customer record.
    expect(Object.keys(call!)).not.toContain('requestBody');
    expect(Object.keys(call!)).not.toContain('responseBody');
  });
});

describe('reading a mapped path', () => {
  it('walks a dotted path', () => {
    expect(readPath({ a: { b: { c: 7 } } }, 'a.b.c')).toBe(7);
  });

  it('returns the root for an empty path', () => {
    expect(readPath({ a: 1 }, '')).toEqual({ a: 1 });
  });

  it('refuses prototype keys', () => {
    // Mappings are tenant-authored. A data path must not become a code path.
    expect(readPath({}, '__proto__.polluted')).toBeUndefined();
    expect(readPath({}, 'constructor.prototype')).toBeUndefined();
  });

  it('is undefined rather than throwing on a missing branch', () => {
    expect(readPath({ a: 1 }, 'a.b.c')).toBeUndefined();
  });
});

describe('credential handling', () => {
  const KEY = Buffer.alloc(32, 7).toString('base64');

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = KEY;
    resetKeyCache();
  });

  it('round-trips a secret', () => {
    const sealed = encryptSecret('super-secret-api-key');
    expect(sealed).not.toContain('super-secret');
    expect(decryptSecret(sealed)).toBe('super-secret-api-key');
  });

  it('produces a different ciphertext each time', () => {
    // A fresh IV per encryption. Identical ciphertexts would leak that two
    // tenants configured the same key.
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'));
  });

  it('refuses a tampered ciphertext instead of returning garbage', () => {
    const sealed = encryptSecret('super-secret-api-key');
    const parts = sealed.split('.');
    const tampered = [parts[0], parts[1], parts[2], `${parts[3]!.slice(0, -2)}AA`].join('.');
    expect(() => decryptSecret(tampered)).toThrow(/could not decrypt/i);
  });

  it('refuses a value sealed with a different key', () => {
    const sealed = encryptSecret('super-secret-api-key');
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
    resetKeyCache();
    expect(() => decryptSecret(sealed)).toThrow(/could not decrypt/i);
  });

  it('masks to the last four characters only', () => {
    expect(maskSecret('sk-live-abcd1234')).toBe('••••1234');
    expect(maskSecret('abc')).toBe('••••');
  });
});

describe('a connector that needs a credential it does not have', () => {
  it('fails with a clear message rather than calling unauthenticated', async () => {
    await prisma.connector.updateMany({
      where: { tenantId: TEST_TENANT },
      data: { kind: 'HTTP', baseUrl: 'https://lms.example.com', authType: 'BEARER' },
    });
    await expect(invoke('find_parent_by_phone', { phone: '1' }))
      .rejects.toBeInstanceOf(ConnectorError);
  });
});
