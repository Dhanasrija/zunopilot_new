import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { prisma } from '../../../config/prisma.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { ApiError } from '../../../utils/ApiError.js';
import { tenantIdOf } from '../../../middleware/auth.js';
import { encryptSecret, encryptionAvailable, maskSecret } from '../../../config/crypto.js';
import { assertUrlAllowed, EgressBlockedError } from '../providers/egress.js';
import { invokeOperation, ConnectorError, placeholdersIn } from '../connectors/invoke.js';
import { MOCK_CONNECTORS } from '../connectors/mock-connectors.js';
import {
  SENDS_BODY,
  connectorCreateSchema, connectorUpdateSchema,
  operationCreateSchema, operationUpdateSchema,
} from '../connectors/schemas.js';

// Connector administration.
//
// Two rules run through all of it:
//
//   • Secrets are write-only. They go in encrypted and never come back out —
//     the API returns a four-character hint so an operator can tell which key
//     is configured without the API ever being a way to read one.
//   • A base URL is validated when it is *saved*, not when it is called. A
//     rejection belongs in the form while someone is looking at it, and it
//     means every stored connector is one the egress guard already approved.

/** Everything safe to return. `secret` is structurally absent, not filtered. */
const connectorSelect = {
  id: true,
  key: true,
  name: true,
  description: true,
  kind: true,
  /// Which catalog entry this came from, or null for one registered by hand.
  connectorTypeId: true,
  baseUrl: true,
  authType: true,
  authConfig: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  operations: {
    select: {
      id: true,
      key: true,
      name: true,
      description: true,
      method: true,
      path: true,
      inputs: true,
      responseMapping: true,
      sideEffecting: true,
      timeoutMs: true,
      sampleResponse: true,
      bodyTemplate: true,
    },
    orderBy: { key: 'asc' },
  },
  secret: { select: { hint: true, updatedAt: true } },
} satisfies Prisma.ConnectorSelect;

const requireConnector = async (req: Request) => {
  const connector = await prisma.connector.findFirst({
    where: { id: req.params.connectorId, tenantId: tenantIdOf(req) },
    select: connectorSelect,
  });
  if (!connector) throw ApiError.notFound('Connector not found');
  return connector;
};

/** A base URL is required for a real HTTP connector and meaningless for a mock. */
const checkBaseUrl = (kind: string, baseUrl: string | null | undefined) => {
  if (kind !== 'HTTP') return;
  if (!baseUrl) throw ApiError.badRequest('An HTTP connector needs a base URL');
  try {
    assertUrlAllowed(baseUrl);
  } catch (err) {
    if (err instanceof EgressBlockedError) throw ApiError.badRequest(err.message);
    throw err;
  }
};

/** What the picker needs, and only that. A type holds no secret, so this is all of it. */
const connectorTypeSelect = {
  id: true,
  key: true,
  label: true,
  description: true,
  kind: true,
  allowedAuthTypes: true,
  defaultBaseUrl: true,
  secretLabel: true,
  usernameLabel: true,
  defaultHeader: true,
  docsUrl: true,
  operationTemplates: {
    select: {
      key: true,
      name: true,
      description: true,
      method: true,
      path: true,
      inputs: true,
      responseMapping: true,
      sideEffecting: true,
      timeoutMs: true,
      sampleResponse: true,
      bodyTemplate: true,
    },
    orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
  },
} satisfies Prisma.ConnectorTypeSelect;

/**
 * The catalog, as a tenant sees it.
 *
 * Active entries only: a retired type must not be offered, and `createConnector` refuses
 * one anyway — this simply means the form never shows a choice the API would reject.
 * Not tenant-scoped because the catalog is the operator's, shared by everyone.
 */
export const listConnectorTypes = asyncHandler(async (_req: Request, res: Response) => {
  const types = await prisma.connectorType.findMany({
    where: { isActive: true },
    select: connectorTypeSelect,
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
  });
  res.json({ success: true, data: types });
});

/**
 * Resolve the catalog entry a tenant is creating from, and check it may be used.
 *
 * Refuses an inactive type explicitly rather than 404ing it. The operator hid it on
 * purpose, and "this integration is no longer offered" is a different fact from "no such
 * thing", which is what somebody staring at a stale browser tab needs to be told.
 */
const resolveConnectorType = async (connectorTypeId: string, authType: string) => {
  const type = await prisma.connectorType.findUnique({
    where: { id: connectorTypeId },
    select: { ...connectorTypeSelect, label: true, isActive: true },
  });
  if (!type) throw ApiError.notFound('Connector type not found');
  if (!type.isActive) {
    throw ApiError.badRequest(`"${type.label}" is no longer offered for new connections`);
  }
  // An empty list means the type has no opinion — a generic HTTP connector accepts
  // whatever the tenant's own API needs.
  if (type.allowedAuthTypes.length > 0 && !type.allowedAuthTypes.includes(authType as never)) {
    throw ApiError.badRequest(
      `"${type.label}" does not use ${authType}. It accepts: ${type.allowedAuthTypes.join(', ')}`,
    );
  }
  return type;
};

export const listConnectors = asyncHandler(async (req: Request, res: Response) => {
  const connectors = await prisma.connector.findMany({
    where: { tenantId: tenantIdOf(req) },
    select: connectorSelect,
    orderBy: { name: 'asc' },
  });

  res.json({
    success: true,
    data: connectors,
    meta: {
      // The UI needs to explain *why* saving a credential is unavailable rather
      // than letting someone fill in a form that cannot be submitted.
      encryptionConfigured: encryptionAvailable(),
      mockConnectorKeys: Object.keys(MOCK_CONNECTORS),
    },
  });
});

export const getConnector = asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await requireConnector(req) });
});

export const createConnector = asyncHandler(async (req: Request, res: Response) => {
  const body = connectorCreateSchema.parse(req.body);

  // The catalog entry, when the tenant picked one. It decides the `kind` and narrows the
  // auth type; the base URL and the credential still come from the tenant, so a type is a
  // starting point rather than a cage.
  const type = body.connectorTypeId
    ? await resolveConnectorType(body.connectorTypeId, body.authType)
    : null;
  const kind = type?.kind ?? body.kind;
  const baseUrl = body.baseUrl ?? type?.defaultBaseUrl ?? null;
  checkBaseUrl(kind, baseUrl);

  if (body.secret && !encryptionAvailable()) {
    throw ApiError.badRequest(
      'ENCRYPTION_KEY is not configured on the server, so credentials cannot be stored. '
      + 'Generate one with: openssl rand -base64 32',
    );
  }
  if (body.authType !== 'NONE' && !body.secret) {
    throw ApiError.badRequest(`Auth type ${body.authType} needs a credential`);
  }

  try {
    const connector = await prisma.connector.create({
      data: {
        tenantId: tenantIdOf(req),
        connectorTypeId: type?.id ?? null,
        key: body.key,
        name: body.name,
        description: body.description ?? null,
        kind,
        baseUrl,
        authType: body.authType,
        authConfig: body.authConfig as Prisma.InputJsonValue,
        ...(body.secret
          ? {
            secret: {
              create: {
                ciphertext: encryptSecret(body.secret),
                hint: maskSecret(body.secret),
              },
            },
          }
          : {}),
        // **The clone, in the same write as the connector.**
        //
        // Nested creates are part of the connector's own transaction, so there is no state
        // where a tenant owns a connector whose operations only half-arrived. It is also a
        // one-time snapshot: from here the operations are theirs to edit, and a later change
        // to the catalog does not reach back and rewrite what their published workflows call.
        ...(type && type.operationTemplates.length > 0
          ? {
            operations: {
              create: type.operationTemplates.map((template) => ({
                key: template.key,
                name: template.name,
                description: template.description,
                method: template.method,
                path: template.path,
                inputs: template.inputs as Prisma.InputJsonValue,
                responseMapping: template.responseMapping as Prisma.InputJsonValue,
                sideEffecting: template.sideEffecting,
                timeoutMs: template.timeoutMs,
                sampleResponse: template.sampleResponse as Prisma.InputJsonValue,
                bodyTemplate: template.bodyTemplate as Prisma.InputJsonValue,
              })),
            },
          }
          : {}),
      },
      select: connectorSelect,
    });
    res.status(201).json({ success: true, data: connector });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw ApiError.conflict(`Another connector already uses the key "${body.key}"`);
    }
    throw err;
  }
});

export const updateConnector = asyncHandler(async (req: Request, res: Response) => {
  const existing = await requireConnector(req);
  const body = connectorUpdateSchema.parse(req.body);

  // Only re-check when one of the two things it depends on actually changed. This read
  // correctly and behaved wrongly while `connectorUpdateSchema` was a `.partial()` over
  // defaults: `body.kind` was never undefined, so every edit re-checked as `HTTP` and a
  // fixture connector — which legitimately has no base URL — could not be renamed at all.
  const kind = body.kind ?? existing.kind;
  if (body.baseUrl !== undefined || body.kind !== undefined) {
    checkBaseUrl(kind, body.baseUrl === undefined ? existing.baseUrl : body.baseUrl);
  }

  if (body.secret && !encryptionAvailable()) {
    throw ApiError.badRequest('ENCRYPTION_KEY is not configured, so credentials cannot be stored');
  }

  const connector = await prisma.connector.update({
    where: { id: existing.id },
    data: {
      ...(body.key !== undefined ? { key: body.key } : {}),
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description ?? null } : {}),
      ...(body.kind !== undefined ? { kind: body.kind } : {}),
      ...(body.baseUrl !== undefined ? { baseUrl: body.baseUrl ?? null } : {}),
      ...(body.authType !== undefined ? { authType: body.authType } : {}),
      ...(body.authConfig !== undefined ? { authConfig: body.authConfig as Prisma.InputJsonValue } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      // Absent means "leave the credential alone". Only a non-empty value
      // replaces it, so saving the form without retyping a secret is safe.
      ...(body.secret
        ? {
          secret: {
            upsert: {
              create: { ciphertext: encryptSecret(body.secret), hint: maskSecret(body.secret) },
              update: { ciphertext: encryptSecret(body.secret), hint: maskSecret(body.secret) },
            },
          },
        }
        : {}),
    },
    select: connectorSelect,
  });

  res.json({ success: true, data: connector });
});

export const deleteConnector = asyncHandler(async (req: Request, res: Response) => {
  const connector = await requireConnector(req);
  await prisma.connector.delete({ where: { id: connector.id } });
  res.json({ success: true });
});

// ── Operations ────────────────────────────────────────────────────────────────

/**
 * Check a body template against the operation it belongs to, when it is saved.
 *
 * Both rules exist so the rejection lands in the form while somebody is looking at it,
 * rather than inside a customer's conversation at three in the morning — the same reasoning
 * as validating a base URL on save.
 *
 * `method` and `inputs` are passed in resolved, because on a partial update either may be
 * absent from the request and the stored value is what will apply.
 */
const checkBodyTemplate = (
  template: unknown,
  method: string,
  inputs: Array<{ key: string }>,
) => {
  if (template === undefined || template === null) return;

  if (!SENDS_BODY.includes(method.toUpperCase())) {
    throw ApiError.badRequest(
      `A ${method.toUpperCase()} request sends no body, so a payload would be dropped. `
      + `Use ${SENDS_BODY.join(', ')}, or put the values in the query string.`,
    );
  }

  // A placeholder naming an input that does not exist can never be filled, so the operation
  // would fail on its first real call. Declaring the input is the fix, and saying which one
  // is missing is the difference between that being obvious and being a puzzle.
  const declared = new Set(inputs.map((i) => i.key));
  const unknown = placeholdersIn(template).filter((name) => !declared.has(name));
  if (unknown.length) {
    throw ApiError.badRequest(
      `The payload uses ${unknown.join(', ')}, which ${unknown.length === 1 ? 'is' : 'are'} `
      + 'not a declared input. Add it below, or correct the placeholder.',
    );
  }
};

export const createOperation = asyncHandler(async (req: Request, res: Response) => {
  const connector = await requireConnector(req);
  const body = operationCreateSchema.parse(req.body);
  checkBodyTemplate(body.bodyTemplate, body.method, body.inputs);

  try {
    const operation = await prisma.connectorOperation.create({
      data: {
        connectorId: connector.id,
        key: body.key,
        name: body.name,
        description: body.description ?? null,
        method: body.method,
        path: body.path,
        inputs: body.inputs as unknown as Prisma.InputJsonValue,
        responseMapping: body.responseMapping as unknown as Prisma.InputJsonValue,
        sideEffecting: body.sideEffecting,
        timeoutMs: body.timeoutMs ?? null,
        sampleResponse: (body.sampleResponse ?? null) as Prisma.InputJsonValue,
        bodyTemplate: (body.bodyTemplate ?? null) as Prisma.InputJsonValue,
      },
    });
    res.status(201).json({ success: true, data: operation });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw ApiError.conflict(`This connector already has an operation "${body.key}"`);
    }
    throw err;
  }
});

export const updateOperation = asyncHandler(async (req: Request, res: Response) => {
  const connector = await requireConnector(req);
  const body = operationUpdateSchema.parse(req.body);

  const existing = await prisma.connectorOperation.findFirst({
    where: { id: req.params.operationId, connectorId: connector.id },
  });
  if (!existing) throw ApiError.notFound('Operation not found');

  // Resolved against what is stored, because either may be absent from a partial update and
  // the stored value is what the template will actually run against.
  const method = body.method ?? existing.method;
  const inputs = body.inputs
    ?? (existing.inputs as Array<{ key: string }> | null)
    ?? [];
  const template = body.bodyTemplate === undefined ? existing.bodyTemplate : body.bodyTemplate;
  checkBodyTemplate(template, method, inputs);

  const operation = await prisma.connectorOperation.update({
    where: { id: existing.id },
    data: {
      ...(body.key !== undefined ? { key: body.key } : {}),
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description ?? null } : {}),
      ...(body.method !== undefined ? { method: body.method } : {}),
      ...(body.path !== undefined ? { path: body.path } : {}),
      ...(body.inputs !== undefined ? { inputs: body.inputs as unknown as Prisma.InputJsonValue } : {}),
      ...(body.responseMapping !== undefined
        ? { responseMapping: body.responseMapping as unknown as Prisma.InputJsonValue }
        : {}),
      ...(body.sideEffecting !== undefined ? { sideEffecting: body.sideEffecting } : {}),
      ...(body.timeoutMs !== undefined ? { timeoutMs: body.timeoutMs ?? null } : {}),
      ...(body.sampleResponse !== undefined
        ? { sampleResponse: (body.sampleResponse ?? null) as Prisma.InputJsonValue }
        : {}),
      ...(body.bodyTemplate !== undefined
        ? { bodyTemplate: (body.bodyTemplate ?? null) as Prisma.InputJsonValue }
        : {}),
    },
  });

  res.json({ success: true, data: operation });
});

export const deleteOperation = asyncHandler(async (req: Request, res: Response) => {
  const connector = await requireConnector(req);
  const { count } = await prisma.connectorOperation.deleteMany({
    where: { id: req.params.operationId, connectorId: connector.id },
  });
  if (!count) throw ApiError.notFound('Operation not found');
  res.json({ success: true });
});

/**
 * Call an operation from the admin UI, so it can be proved before a workflow
 * depends on it.
 *
 * A side-effecting operation is refused here unless the caller says so
 * explicitly — "Test" on a `cancel_class` button should not cancel a real
 * class because someone was curious what the response looked like.
 */
export const testOperation = asyncHandler(async (req: Request, res: Response) => {
  const connector = await requireConnector(req);
  const operation = connector.operations.find((o) => o.id === req.params.operationId);
  if (!operation) throw ApiError.notFound('Operation not found');

  const inputs = (req.body?.inputs ?? {}) as Record<string, unknown>;
  const confirmed = req.body?.confirmSideEffect === true;

  if (operation.sideEffecting && !confirmed) {
    throw ApiError.badRequest(
      `"${operation.name}" changes data on the far end. Re-send with confirmSideEffect: true to run it for real.`,
    );
  }

  try {
    const result = await invokeOperation({
      tenantId: tenantIdOf(req),
      connectorKey: connector.key,
      operationKey: operation.key,
      inputs,
    });
    res.json({
      success: true,
      data: {
        status: result.status,
        ok: result.ok,
        durationMs: result.durationMs,
        body: result.body,
        items: result.items.map(({ raw, ...row }) => row),
        itemCount: result.items.length,
      },
    });
  } catch (err) {
    if (err instanceof ConnectorError) {
      res.status(200).json({
        success: true,
        data: { ok: false, error: { code: err.code, message: err.message } },
      });
      return;
    }
    throw err;
  }
});
