import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// What actually goes on the wire.
//
// `render-body.test.ts` proves the template renders. This proves the rendered thing is what
// gets sent — a distinction that matters, because the whole feature is one line in `invoke.ts`
// choosing between the template and the older flat body, and a test of the renderer alone
// would pass just as happily if that line were never wired up.
//
// The egress module is mocked rather than reached. It is the SSRF guard, and the escape hatch
// that would let a test call localhost is a snapshot read at import time — turning it on for
// the suite would disable the guard for `egress.test.ts` as well. Asserting on the arguments
// is both safer and a sharper test: it reads the exact bytes.

/** The one argument shape this test reads back. Typed, so the assertions below type-check. */
interface EgressCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
  timeoutMs?: number;
}

const egressRequest = vi.fn(
  async (_request: EgressCall) => ({ status: 200, body: { ok: true } as unknown }),
);

vi.mock('../providers/egress.js', () => ({
  egressRequest,
  assertUrlAllowed: () => {},
  EgressBlockedError: class extends Error {},
  EgressTimeoutError: class extends Error {},
}));

const { prisma } = await import('../../../config/prisma.js');
const { invokeOperation } = await import('./invoke.js');

const TENANT = 'dddddddd-d000-0000-0000-00000000d001';

const wipe = () => prisma.tenant.deleteMany({ where: { id: TENANT } });

/** One HTTP connector with one POST operation, whose body template the test supplies. */
const seed = async (operation: {
  method?: string;
  inputs?: unknown;
  bodyTemplate?: unknown;
}) => {
  await prisma.tenant.create({
    data: { id: TENANT, businessName: 'Wire Test', category: 'RESTAURANT' },
  });
  await prisma.connector.create({
    data: {
      tenantId: TENANT,
      key: 'payapi',
      name: 'Pay API',
      kind: 'HTTP',
      baseUrl: 'https://api.example.com/v1',
      authType: 'NONE',
      operations: {
        create: {
          key: 'refund',
          name: 'Refund',
          method: operation.method ?? 'POST',
          path: '/payments/{payment_id}/refund',
          inputs: (operation.inputs ?? [
            { key: 'payment_id', label: 'Payment', type: 'string', required: true, in: 'path' },
            { key: 'amount', label: 'Amount', type: 'number', required: true, in: 'body' },
          ]) as never,
          bodyTemplate: (operation.bodyTemplate ?? null) as never,
        },
      },
    },
  });
};

const invoke = (inputs: Record<string, unknown>) => invokeOperation({
  tenantId: TENANT,
  connectorKey: 'payapi',
  operationKey: 'refund',
  inputs,
});

/** The JSON body the call path handed to the egress guard. */
const sentBody = () => JSON.parse(egressRequest.mock.calls[0]![0].body as string);

beforeEach(async () => {
  egressRequest.mockClear();
  await wipe();
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('with a body template', () => {
  it('**sends the rendered template, typed**', async () => {
    await seed({
      bodyTemplate: { amount: '{amount}', currency: 'INR', notes: { via: 'whatsapp' } },
    });
    await invoke({ payment_id: 'pay_1', amount: '500' });

    // `amount` arrived as the string "500" from the workflow, was coerced to a number by the
    // input's declared type, and reaches the API as a number — which is the whole reason
    // whole-value substitution is not string interpolation.
    expect(sentBody()).toEqual({ amount: 500, currency: 'INR', notes: { via: 'whatsapp' } });
  });

  it('still puts path inputs in the URL, not the body', async () => {
    await seed({ bodyTemplate: { amount: '{amount}' } });
    await invoke({ payment_id: 'pay_9', amount: '10' });

    expect(egressRequest.mock.calls[0]![0].url).toBe('https://api.example.com/v1/payments/pay_9/refund');
    expect(sentBody()).toEqual({ amount: 10 });
  });

  it('refuses the call when a placeholder cannot be filled', async () => {
    await seed({
      inputs: [
        { key: 'payment_id', label: 'Payment', type: 'string', required: true, in: 'path' },
        { key: 'reason', label: 'Reason', type: 'string', required: false, in: 'body' },
      ],
      bodyTemplate: { reason: '{reason}' },
    });

    // Thrown, not returned as `ok: false` — the same treatment a missing required input and
    // an unfilled path placeholder already get. `ok: false` is reserved for a real response
    // with an unhappy status, which is a branch of the conversation rather than a fault.
    await expect(invoke({ payment_id: 'pay_1' })).rejects.toMatchObject({ code: 'MISSING_INPUT' });
    // And nothing left the process — a half-formed body must not reach someone else's API.
    expect(egressRequest).not.toHaveBeenCalled();
  });

  it('sets a JSON content type', async () => {
    await seed({ bodyTemplate: { amount: '{amount}' } });
    await invoke({ payment_id: 'p', amount: '1' });
    expect(egressRequest.mock.calls[0]![0].headers['Content-Type']).toBe('application/json');
  });
});

describe('without a body template', () => {
  it('**sends the old flat body, unchanged**', async () => {
    // The backward-compatibility claim, tested rather than asserted: every operation that
    // predates templates has a null one and must behave exactly as it did.
    await seed({ bodyTemplate: null });
    await invoke({ payment_id: 'pay_1', amount: '500' });

    expect(sentBody()).toEqual({ amount: 500 });
  });

  it('sends no body at all on a GET', async () => {
    await seed({ method: 'GET', bodyTemplate: null });
    await invoke({ payment_id: 'pay_1', amount: '500' });

    expect(egressRequest.mock.calls[0]![0].body).toBeNull();
  });
});
