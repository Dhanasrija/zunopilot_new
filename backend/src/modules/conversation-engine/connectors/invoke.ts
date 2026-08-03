import type { Connector, ConnectorOperation, ConnectorSecret } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import { withContext } from '../../../config/logger.js';
import { decryptSecret } from '../../../config/crypto.js';
import { egressRequest, EgressBlockedError, EgressTimeoutError } from '../providers/egress.js';
import { mockHandlerFor } from './mock-connectors.js';
import { operationInputSchema, responseMappingSchema, type OperationInput } from './schemas.js';

// Calling one connector operation.
//
// Everything a node needs is here, and nothing a node should be able to choose
// is: the URL, the credential and the method all come from the registered
// connector, and the node only supplies values for declared inputs.

export class ConnectorError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, code: string, retryable = false) {
    super(message);
    this.name = 'ConnectorError';
    this.code = code;
    this.retryable = retryable;
  }
}

export interface InvokeResult {
  ok: boolean;
  status: number;
  body: unknown;
  /** The array the operation's mapping points at, normalised to rows. */
  items: Array<{ id: string; title: string; description?: string; raw: unknown }>;
  durationMs: number;
}

type LoadedConnector = Connector & {
  operations: ConnectorOperation[];
  secret: ConnectorSecret | null;
};

/**
 * Read a dotted path out of a value.
 *
 * A whitelisted walker, not an expression evaluator. Prototype keys are
 * refused: a mapping is tenant-authored, and `__proto__.foo` reaching into an
 * object graph is how a data path becomes a code path.
 */
export const readPath = (source: unknown, path: string): unknown => {
  if (!path) return source;
  let current: unknown = source;
  for (const segment of path.split('.')) {
    if (!segment) continue;
    if (segment === '__proto__' || segment === 'constructor' || segment === 'prototype') return undefined;
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
};

/** Load a connector with everything a call needs, scoped to one tenant. */
export const loadConnector = async (
  tenantId: string,
  key: string,
): Promise<LoadedConnector | null> => prisma.connector.findFirst({
  where: { tenantId, key },
  include: { operations: true, secret: true },
});

const authHeaders = (connector: LoadedConnector): Record<string, string> => {
  if (connector.authType === 'NONE') return {};

  if (!connector.secret) {
    throw new ConnectorError(
      `Connector "${connector.key}" is set to ${connector.authType} but has no credential saved`,
      'MISSING_CREDENTIAL',
    );
  }

  const secret = decryptSecret(connector.secret.ciphertext);
  const config = (connector.authConfig ?? {}) as { header?: string; username?: string };

  switch (connector.authType) {
    case 'BEARER':
      return { Authorization: `Bearer ${secret}` };
    case 'API_KEY_HEADER':
      return { [config.header || 'X-API-Key']: secret };
    case 'BASIC':
      return {
        Authorization: `Basic ${Buffer.from(`${config.username ?? ''}:${secret}`).toString('base64')}`,
      };
    default:
      return {};
  }
};

/**
 * Split the supplied values across path, query, body and headers according to
 * what the operation declared.
 *
 * A value the operation did not declare is dropped rather than passed through.
 * Forwarding undeclared keys would let a workflow author smuggle parameters the
 * connector's owner never approved — the whole point of declaring operations.
 */
const placeValues = (
  inputs: OperationInput[],
  supplied: Record<string, unknown>,
): {
  path: Record<string, string>;
  query: Record<string, string>;
  body: Record<string, unknown>;
  headers: Record<string, string>;
  missing: string[];
} => {
  const out = {
    path: {} as Record<string, string>,
    query: {} as Record<string, string>,
    body: {} as Record<string, unknown>,
    headers: {} as Record<string, string>,
    missing: [] as string[],
  };

  for (const declared of inputs) {
    const raw = supplied[declared.key];
    const present = raw !== undefined && raw !== null && String(raw).trim() !== '';

    if (!present) {
      if (declared.required) out.missing.push(declared.key);
      continue;
    }

    const coerced = declared.type === 'number' ? Number(raw)
      : declared.type === 'boolean' ? (String(raw) === 'true' || raw === true)
        : String(raw);

    switch (declared.in) {
      case 'path': out.path[declared.key] = encodeURIComponent(String(coerced)); break;
      case 'body': out.body[declared.key] = coerced; break;
      case 'header': out.headers[declared.key] = String(coerced); break;
      default: out.query[declared.key] = String(coerced);
    }
  }

  return out;
};

/** Fill `{placeholders}` in an operation path. Unfilled ones are an error, not a literal. */
const buildPath = (template: string, values: Record<string, string>): string => {
  const missing: string[] = [];
  const filled = template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name: string) => {
    const value = values[name];
    if (value === undefined) { missing.push(name); return ''; }
    return value;
  });
  if (missing.length) {
    throw new ConnectorError(
      `The operation path needs ${missing.join(', ')}, which was not supplied`,
      'MISSING_INPUT',
    );
  }
  return filled;
};

/** Normalise whatever came back into rows a LIST_MESSAGE can render. */
const extractItems = (
  body: unknown,
  mapping: ReturnType<typeof responseMappingSchema.parse>,
): InvokeResult['items'] => {
  const located = readPath(body, mapping.itemsPath);
  if (!Array.isArray(located)) return [];

  return located.flatMap((entry) => {
    const id = readPath(entry, mapping.idField);
    const title = readPath(entry, mapping.titleField);
    if (id === undefined || title === undefined) return [];
    const description = mapping.descriptionField
      ? readPath(entry, mapping.descriptionField)
      : undefined;
    return [{
      id: String(id),
      title: String(title),
      ...(description === undefined || description === null ? {} : { description: String(description) }),
      raw: entry,
    }];
  });
};

export interface InvokeArgs {
  tenantId: string;
  connectorKey: string;
  operationKey: string;
  inputs: Record<string, unknown>;
  /** Recorded on the audit row so a call can be traced to the run that made it. */
  workflowInstanceId?: string | null;
  nodeExecutionId?: string | null;
  dryRun?: boolean;
}

export const invokeOperation = async (args: InvokeArgs): Promise<InvokeResult> => {
  const logger = withContext({ tenantId: args.tenantId });

  const connector = await loadConnector(args.tenantId, args.connectorKey);
  if (!connector) {
    throw new ConnectorError(`No connector named "${args.connectorKey}"`, 'UNKNOWN_CONNECTOR');
  }
  if (connector.status !== 'ACTIVE') {
    throw new ConnectorError(`Connector "${connector.name}" is disabled`, 'CONNECTOR_DISABLED');
  }

  const operation = connector.operations.find((o) => o.key === args.operationKey);
  if (!operation) {
    throw new ConnectorError(
      `Connector "${connector.name}" has no operation "${args.operationKey}"`,
      'UNKNOWN_OPERATION',
    );
  }

  const declared = operationInputSchema.array().parse(operation.inputs ?? []);
  const mapping = responseMappingSchema.parse(operation.responseMapping ?? {});
  const placed = placeValues(declared, args.inputs);

  if (placed.missing.length) {
    throw new ConnectorError(
      `Missing required input${placed.missing.length > 1 ? 's' : ''}: ${placed.missing.join(', ')}`,
      'MISSING_INPUT',
    );
  }

  // A dry run must never reach a real system, and must never *look* like it
  // did. The sample response is what the operation's author recorded, so the
  // simulator shows the shape without the side effect.
  if (args.dryRun) {
    const body = operation.sampleResponse ?? { dryRun: true };
    return { ok: true, status: 200, body, items: extractItems(body, mapping), durationMs: 0 };
  }

  const startedAt = Date.now();
  let result: { status: number; body: unknown };
  let failure: string | null = null;

  try {
    if (connector.kind === 'MOCK') {
      const handler = mockHandlerFor(connector.key, operation.key);
      if (!handler) {
        throw new ConnectorError(
          `Mock connector "${connector.key}" has no fixture for "${operation.key}"`,
          'UNKNOWN_OPERATION',
        );
      }
      result = await handler({ ...placed.query, ...placed.body, ...placed.path, ...args.inputs });
    } else if (connector.kind === 'HTTP') {
      if (!connector.baseUrl) {
        throw new ConnectorError(`Connector "${connector.name}" has no base URL`, 'NO_BASE_URL');
      }

      const path = buildPath(operation.path, placed.path);
      const url = new URL(path.replace(/^\//, ''), connector.baseUrl.endsWith('/') ? connector.baseUrl : `${connector.baseUrl}/`);
      for (const [name, value] of Object.entries(placed.query)) url.searchParams.set(name, value);

      const sendsBody = ['POST', 'PUT', 'PATCH'].includes(operation.method.toUpperCase());
      const response = await egressRequest({
        method: operation.method,
        url: url.toString(),
        headers: {
          Accept: 'application/json',
          ...(sendsBody ? { 'Content-Type': 'application/json' } : {}),
          ...placed.headers,
          ...authHeaders(connector),
        },
        body: sendsBody ? JSON.stringify(placed.body) : null,
        ...(operation.timeoutMs ? { timeoutMs: operation.timeoutMs } : {}),
      });
      result = { status: response.status, body: response.body };
    } else {
      throw new ConnectorError(
        `${connector.kind} connectors are not implemented yet`,
        'UNSUPPORTED_KIND',
      );
    }
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
    await recordCall(args, connector.id, operation.id, {
      status: 'FAILED', durationMs: Date.now() - startedAt, error: failure,
    });

    if (err instanceof EgressTimeoutError) {
      // Worth retrying — the far end was slow, not wrong.
      throw new ConnectorError(failure, 'TIMEOUT', true);
    }
    if (err instanceof EgressBlockedError) {
      throw new ConnectorError(failure, 'EGRESS_BLOCKED');
    }
    throw err instanceof ConnectorError ? err : new ConnectorError(failure, 'REQUEST_FAILED', true);
  }

  const durationMs = Date.now() - startedAt;
  const ok = result.status >= 200 && result.status < 300;

  await recordCall(args, connector.id, operation.id, {
    status: ok ? 'SUCCESS' : 'HTTP_ERROR',
    httpStatus: result.status,
    durationMs,
  });

  logger.debug('Connector call finished', { status: result.status, durationMs });

  return { ok, status: result.status, body: result.body, items: extractItems(result.body, mapping), durationMs };
};

/**
 * Audit row. Deliberately no request or response bodies — those carry customer
 * data and, for a misconfigured connector, credentials. Status, timing and the
 * run that made the call are enough to debug with.
 */
const recordCall = async (
  args: InvokeArgs,
  connectorId: string,
  operationId: string,
  outcome: { status: string; httpStatus?: number; durationMs: number; error?: string },
): Promise<void> => {
  try {
    await prisma.connectorCall.create({
      data: {
        tenantId: args.tenantId,
        connectorId,
        operationId,
        workflowInstanceId: args.workflowInstanceId ?? null,
        nodeExecutionId: args.nodeExecutionId ?? null,
        status: outcome.status,
        httpStatus: outcome.httpStatus ?? null,
        durationMs: outcome.durationMs,
        error: outcome.error?.slice(0, 500) ?? null,
      },
    });
  } catch {
    // Losing an audit row must not fail the call the customer is waiting on.
  }
};
