import { z } from 'zod';
import { NODE_CONFIG_SCHEMAS } from '../../domain/node-types.js';
import { startOrderingFlow } from '../../../../services/ordering.service.js';
import type { WorkflowNodeExecutor } from '../types.js';

type StartOrderingConfig = z.infer<typeof NODE_CONFIG_SCHEMAS.START_ORDERING>;

/**
 * Start the ordering / checkout flow.
 *
 * Returns SUCCESS as a terminal step: the cart state machine now owns the
 * conversation, and the routing chain's step 0 will send every following message
 * to it until checkout completes or is abandoned. The workflow instance
 * completes here rather than lingering, which matters because a live instance
 * would block the conversation from ever starting another workflow.
 */
export const startOrderingExecutor: WorkflowNodeExecutor<StartOrderingConfig, { handedOff: true }> = {
  type: 'START_ORDERING',
  validateConfig: (config) => NODE_CONFIG_SCHEMAS.START_ORDERING.parse(config),
  execute: async ({ config, tenant, contact, channel, services, dryRun, logger }) => {
    if (config.introMessage) {
      if (!dryRun) await services.whatsapp.sendText({ to: contact.waId, body: config.introMessage });
    }

    if (dryRun) {
      logger.info('Dry run: ordering flow not started');
      return { status: 'SUCCESS', output: { handedOff: true }, terminal: 'COMPLETED' };
    }

    await startOrderingFlow({ tenant, waAccount: channel, customer: contact });
    logger.info('Handed the conversation to the ordering state machine');

    return { status: 'SUCCESS', output: { handedOff: true }, terminal: 'COMPLETED' };
  },
};
