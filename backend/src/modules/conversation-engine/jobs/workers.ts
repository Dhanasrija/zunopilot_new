import { prisma } from '../../../config/prisma.js';
import { logger } from '../../../config/logger.js';
import { env } from '../../../config/env.js';
import { channelForTenant } from '../../../services/whatsapp-account.service.js';
import { whatsappProviderFor } from '../providers/whatsapp.js';
import { MOCK_INTEGRATIONS, MockHttpCaller, MockLlmProvider } from '../providers/mock.js';
import { dueInstances, expireStaleInstances } from '../engine/instance-manager.js';
import { sweepDueReminders } from '../../leads/lead.service.js';
import { sendCampaignBatch, sendingCampaignIds } from '../../marketing/campaign.service.js';
import { applyDueePlanChanges, billDueOverage } from '../../billing/billing.controller.js';
import { resumeAfterDelay } from '../engine/resume.js';
import { walk, type WalkDeps } from '../engine/walker.js';
import { parseDefinition } from '../domain/definition.js';
import { handleProcessInboundMessage } from './handlers/process-inbound.js';
import { sweepImpersonationGrants } from '../../super-admin/impersonation.js';
import { sweepOtpChallenges } from '../../../services/otp.service.js';
import {
  QUEUES, registerWorker, scheduleMaintenance,
  type ExecuteWorkflowInstanceJob, type SendWhatsAppMessageJob,
} from './queue.js';

// Worker registration.
//
// These are queue consumers, not cron jobs — each one runs because something
// was enqueued. The two exceptions (`resume-delayed-workflow`,
// `expire-stale-instances`) are scheduled sweeps that exist to pick up state
// nothing else will: a delay whose timer outlived the process that set it, and
// an instance nobody is ever going to answer.

/**
 * Rebuild everything a workflow needs to keep running.
 *
 * Loaded fresh per job rather than carried through the queue: a job payload is
 * a snapshot, and a conversation that was handed to a human between enqueue and
 * execution must not be resumed from stale state.
 */
const loadWalkDeps = async (instanceId: string): Promise<{
  deps: WalkDeps;
  instance: NonNullable<Awaited<ReturnType<typeof prisma.workflowInstance.findUnique>>>;
} | null> => {
  const instance = await prisma.workflowInstance.findUnique({ where: { id: instanceId } });
  if (!instance) return null;

  const [tenant, conversation] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: instance.tenantId } }),
    prisma.conversation.findUnique({ where: { id: instance.conversationId } }),
  ]);
  if (!tenant || !conversation) return null;

  const [contact, channel] = await Promise.all([
    prisma.customer.findUnique({ where: { id: conversation.customerId } }),
    channelForTenant(instance.tenantId),
  ]);
  if (!contact || !channel) return null;

  if (conversation.automationPaused) {
    logger.info('Skipping workflow execution: a human has the conversation', {
      workflowInstanceId: instanceId,
    });
    return null;
  }

  return {
    instance,
    deps: {
      tenant,
      contact,
      conversation,
      channel,
      assistantId: conversation.assistantId,
      services: {
        whatsapp: whatsappProviderFor(channel),
        llm: new MockLlmProvider(),
        http: new MockHttpCaller(),
        integrations: MOCK_INTEGRATIONS,
      },
      latestMessage: null,
    },
  };
};

const handleExecuteWorkflowInstance = async ({ workflowInstanceId }: ExecuteWorkflowInstanceJob) => {
  const loaded = await loadWalkDeps(workflowInstanceId);
  if (!loaded) return;

  const version = await prisma.workflowVersion.findUnique({
    where: { id: loaded.instance.workflowVersionId },
  });
  if (!version) return;

  await walk({
    instance: loaded.instance,
    definition: parseDefinition(version.definition),
    deps: loaded.deps,
  });
};

/** Sweep: resume every instance whose delay has elapsed. */
const handleResumeDelayedWorkflows = async () => {
  const due = await dueInstances(25);
  for (const row of due) {
    const loaded = await loadWalkDeps(row.id);
    if (!loaded) continue;
    try {
      await resumeAfterDelay({ instance: loaded.instance, deps: loaded.deps });
    } catch (err) {
      logger.error('Failed to resume delayed workflow', {
        workflowInstanceId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (due.length) logger.info('Resumed delayed workflows', { count: due.length });
};

/**
 * Outbound send as a job.
 *
 * `idempotencyKey` matters here more than anywhere else: a worker that crashes
 * after Meta accepted the message but before the job was acked will retry, and
 * a customer receiving the same message twice is a visible defect.
 */
const handleSendWhatsAppMessage = async (job: SendWhatsAppMessageJob) => {
  const alreadySent = await prisma.message.findFirst({
    where: { tenantId: job.tenantId, payload: { path: ['idempotencyKey'], equals: job.idempotencyKey } },
    select: { id: true },
  });
  if (alreadySent) {
    logger.debug('Skipping duplicate outbound send', { idempotencyKey: job.idempotencyKey });
    return;
  }

  const channel = await prisma.whatsappAccount.findUnique({ where: { id: job.channelId } });
  if (!channel) return;

  const sent = await whatsappProviderFor(channel).sendText({ to: job.to, body: job.body });

  if (job.conversationId) {
    const conversation = await prisma.conversation.findUnique({ where: { id: job.conversationId } });
    if (conversation) {
      await prisma.message.create({
        data: {
          tenantId: job.tenantId,
          conversationId: job.conversationId,
          customerId: conversation.customerId,
          direction: 'OUTBOUND',
          type: 'TEXT',
          status: 'SENT',
          waMessageId: sent.messageId,
          body: job.body,
          payload: { idempotencyKey: job.idempotencyKey },
        },
      });
    }
  }
};

/**
 * Send one slice of every running campaign.
 *
 * `CAMPAIGN_BATCH_SIZE` per campaign per minute is a deliberate throttle, not a
 * performance limit: Meta degrades a number's quality rating under bursts, and a
 * campaign must never starve `process-inbound-whatsapp-message`. Campaigns run
 * sequentially rather than in parallel for the same reason.
 */
const CAMPAIGN_BATCH_SIZE = 25;

const handleSendCampaignBatches = async () => {
  for (const campaignId of await sendingCampaignIds()) {
    try {
      const outcome = await sendCampaignBatch(campaignId, CAMPAIGN_BATCH_SIZE);
      if (outcome.sent || outcome.skipped || outcome.failed) {
        logger.info('Campaign batch sent', { campaignId, ...outcome });
      }
    } catch (err) {
      // One broken campaign must not stop the others from progressing.
      logger.error('Campaign batch failed', {
        campaignId, error: err instanceof Error ? err.message : String(err),
      });
    }
  }
};

/** Stamp lead reminders whose time has come, so the in-app badge can count them. */
const handleSweepDueReminders = async () => {
  await sweepDueReminders();
};

const handleExpireStaleInstances = async () => {
  await expireStaleInstances(env.engine.instanceTimeoutHours);

  // Same hourly sweep closes out support-access grants: a request nobody answered
  // and a window that has run out. Without it a lapsed request sits on a
  // customer's dashboard forever, and an approved grant past its window keeps
  // reading as "active" on the screens even though every token is already
  // refused. Folded in here rather than given its own schedule for the reason
  // stated below — one clock is easier to reason about than two.
  const swept = await sweepImpersonationGrants();
  if (swept.expired || swept.ended) {
    logger.info('Support access swept', swept);
  }

  // Spent login codes. Nothing reads a challenge after the login it belongs to,
  // and keeping them is keeping hashes of credentials for no reason.
  await sweepOtpChallenges();
};

/**
 * Move workspaces onto the plan they scheduled.
 *
 * Razorpay switches its side at cycle end; this is what moves ours to match.
 * It has to be a sweep rather than something that happens when a user opens the
 * billing page, because plan limits are enforced on the inbound message path,
 * where there is no user at all.
 */
const handleApplyPlanChanges = async () => {
  const applied = await applyDueePlanChanges();
  if (applied) logger.info('Applied scheduled plan changes', { applied });

  // Same sweep: both are period-boundary work, and running them together means
  // one schedule to reason about rather than two that can drift apart.
  const billed = await billDueOverage();
  if (billed) logger.info('Billed AI overage', { billed });
};

let started = false;

/** Register every worker. Idempotent, so a second call is a no-op. */
export const startWorkers = async (): Promise<void> => {
  if (started) return;
  started = true;

  await registerWorker(QUEUES.processInboundMessage, handleProcessInboundMessage, { batchSize: 5 });
  await registerWorker(QUEUES.executeWorkflowInstance, handleExecuteWorkflowInstance, { batchSize: 3 });
  await registerWorker(QUEUES.resumeDelayedWorkflow, handleResumeDelayedWorkflows);
  await registerWorker(QUEUES.sendWhatsAppMessage, handleSendWhatsAppMessage, { batchSize: 5 });
  await registerWorker(QUEUES.expireStaleInstances, handleExpireStaleInstances);
  await registerWorker(QUEUES.applyPlanChanges, handleApplyPlanChanges);
  await registerWorker(QUEUES.sweepDueReminders, handleSweepDueReminders);
  await registerWorker(QUEUES.sendCampaignBatches, handleSendCampaignBatches);

  await scheduleMaintenance();

  logger.info('Conversation engine workers started');
};
