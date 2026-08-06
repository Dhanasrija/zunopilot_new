import { z } from 'zod';
import { NODE_CONFIG_SCHEMAS } from '../../domain/node-types.js';
import { invokeOperation, ConnectorError } from '../../connectors/invoke.js';
import { NodeConfigError, RetryableNodeError, type WorkflowNodeExecutor } from '../types.js';

// Calling a registered connector from a workflow.
//
// Two node types, one implementation. They differ only in `sideEffect` on the
// node metadata, and that difference is load-bearing: an ACTION makes the
// publish validator demand a confirmation step, so "cancel my class" cannot be
// published as a flow that cancels without asking.
//
// Neither node carries a URL, a method or a credential. It names a connector
// and an operation, and supplies values for inputs that operation declared.
// Anything undeclared is dropped by the invoker.

type Config = z.infer<typeof NODE_CONFIG_SCHEMAS.CONNECTOR_QUERY>;

interface Output {
  status: number;
  ok: boolean;
  itemCount: number;
  durationMs: number;
}

const run = (type: 'CONNECTOR_QUERY' | 'CONNECTOR_ACTION'): WorkflowNodeExecutor<Config, Output> => ({
  type,
  validateConfig: (config) => NODE_CONFIG_SCHEMAS[type].parse(config),

  execute: async ({
    config, tenantId, variables, workflowInstanceId, nodeExecutionId, dryRun, logger,
  }) => {
    // Templates in the values were already resolved by the walker, so this is
    // the literal set of values to send.
    const inputs: Record<string, unknown> = {};
    for (const input of config.inputs) inputs[input.key] = input.value;

    try {
      const result = await invokeOperation({
        tenantId,
        connectorKey: config.connectorKey,
        operationKey: config.operationKey,
        inputs,
        workflowInstanceId,
        nodeExecutionId,
        dryRun,
      });

      // Rows are stripped of their `raw` payload before being stored. The
      // instance's variables end up in the execution log and in the simulator,
      // and echoing an entire upstream record into both is how customer data
      // spreads into places nobody remembered to redact.
      const rows = result.items.map(({ raw, ...row }) => row);

      const patch: Record<string, unknown> = { [config.outputVariable]: result.body };
      if (config.itemsVariable) patch[config.itemsVariable] = rows;

      logger.debug('Connector node finished', {
        operation: config.operationKey, status: result.status, rows: rows.length,
      });

      return {
        status: 'SUCCESS',
        output: {
          status: result.status,
          ok: result.ok,
          itemCount: rows.length,
          durationMs: result.durationMs,
        },
        variablesPatch: patch,
        // A non-2xx is not a crash — "no parent account for that number" is a
        // 404 and a legitimate branch of the conversation. The graph decides
        // what it means, which is the whole point of the error handle.
        nextHandle: result.ok ? 'success' : 'error',
      };
    } catch (err) {
      if (err instanceof ConnectorError) {
        // A timeout is worth retrying; a misconfigured node is not, and
        // retrying an ACTION that may have already landed is how one
        // cancellation becomes three.
        if (err.retryable && type === 'CONNECTOR_QUERY') throw new RetryableNodeError(err.message, err.code);
        throw new NodeConfigError(err.message);
      }
      throw err;
    }
  },
});

export const connectorQueryExecutor = run('CONNECTOR_QUERY');
export const connectorActionExecutor = run('CONNECTOR_ACTION');
