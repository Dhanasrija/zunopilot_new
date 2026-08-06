import { PgBoss } from 'pg-boss';
import type { Job, JobResult } from 'pg-boss';
import { env } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';

// Job queue.
//
// pg-boss runs on the application's own Postgres in a `pgboss` schema, so there
// is no second datastore to operate and a job enqueued in a transaction is
// durable the moment that transaction commits.
//
// These are worker queues, not cron. The only scheduled entries are the two
// maintenance sweeps at the bottom; everything else is enqueued in response to
// something that happened.

export const QUEUES = {
  processInboundMessage: 'process-inbound-whatsapp-message',
  executeWorkflowInstance: 'execute-workflow-instance',
  resumeDelayedWorkflow: 'resume-delayed-workflow',
  sendWhatsAppMessage: 'send-whatsapp-message',
  executeHttpRequest: 'execute-http-request',
  generateConversationSummary: 'generate-conversation-summary',
  routeConversationMessage: 'route-conversation-message',
  retryFailedNode: 'retry-failed-node',
  /**
   * Deliver one notification to its recipients' subscribed devices.
   *
   * Queued rather than sent inline, for the reason every producer in this module is
   * careful about: the inbound path's job is to store a customer's message, and it
   * must not wait on — or be failed by — a push service having a bad minute.
   */
  deliverPushNotification: 'deliver-push-notification',
  // Maintenance
  expireStaleInstances: 'expire-stale-instances',
  applyPlanChanges: 'apply-scheduled-plan-changes',
  sweepDueReminders: 'sweep-due-reminders',
  sendCampaignBatches: 'send-campaign-batches',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

// ── Job payloads ──────────────────────────────────────────────────────────────

export interface ProcessInboundMessageJob {
  webhookEventId: string;
}

export interface ExecuteWorkflowInstanceJob {
  workflowInstanceId: string;
  tenantId: string;
}

export interface ResumeDelayedWorkflowJob {
  workflowInstanceId: string;
  tenantId: string;
}

export interface SendWhatsAppMessageJob {
  tenantId: string;
  channelId: string;
  to: string;
  body: string;
  conversationId?: string;
  /** Deduplicates a resend after a worker crash mid-ack. */
  idempotencyKey: string;
}

export interface RouteConversationMessageJob {
  tenantId: string;
  conversationId: string;
  messageId: string;
}

export interface GenerateConversationSummaryJob {
  tenantId: string;
  conversationId: string;
}

export interface RetryFailedNodeJob {
  workflowInstanceId: string;
  nodeExecutionId: string;
}

/**
 * Just the id.
 *
 * The notification's text is deliberately *not* carried in the payload: a job payload
 * is a snapshot, and by the time this runs the notification may have been read — in
 * which case pushing it to a phone is noise. Loading it fresh lets the handler decide.
 */
export interface DeliverPushNotificationJob {
  notificationId: string;
}

export interface JobPayloads {
  [QUEUES.processInboundMessage]: ProcessInboundMessageJob;
  [QUEUES.executeWorkflowInstance]: ExecuteWorkflowInstanceJob;
  [QUEUES.resumeDelayedWorkflow]: ResumeDelayedWorkflowJob;
  [QUEUES.sendWhatsAppMessage]: SendWhatsAppMessageJob;
  [QUEUES.routeConversationMessage]: RouteConversationMessageJob;
  [QUEUES.generateConversationSummary]: GenerateConversationSummaryJob;
  [QUEUES.retryFailedNode]: RetryFailedNodeJob;
  [QUEUES.deliverPushNotification]: DeliverPushNotificationJob;
  [QUEUES.executeHttpRequest]: Record<string, unknown>;
  [QUEUES.expireStaleInstances]: Record<string, unknown>;
  [QUEUES.applyPlanChanges]: Record<string, unknown>;
  [QUEUES.sweepDueReminders]: Record<string, unknown>;
  [QUEUES.sendCampaignBatches]: Record<string, unknown>;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

let boss: PgBoss | null = null;
let starting: Promise<PgBoss> | null = null;

/**
 * Per-queue retry policy.
 *
 * Inbound processing gets the most retries because dropping one is a customer
 * message lost forever. Sends get few, because a retry that succeeds after the
 * customer already got the message is worse than not retrying.
 */
const QUEUE_POLICIES: Partial<Record<QueueName, Parameters<PgBoss['createQueue']>[1]>> = {
  [QUEUES.processInboundMessage]: { retryLimit: 5, retryDelay: 5, retryBackoff: true, expireInSeconds: 120 },
  [QUEUES.executeWorkflowInstance]: { retryLimit: 3, retryDelay: 5, retryBackoff: true, expireInSeconds: 180 },
  [QUEUES.resumeDelayedWorkflow]: { retryLimit: 3, retryDelay: 10, retryBackoff: true },
  [QUEUES.sendWhatsAppMessage]: { retryLimit: 2, retryDelay: 3, retryBackoff: true, expireInSeconds: 60 },
  [QUEUES.routeConversationMessage]: { retryLimit: 2, retryDelay: 3 },
  [QUEUES.generateConversationSummary]: { retryLimit: 1 },
  [QUEUES.retryFailedNode]: { retryLimit: 1 },
};

export const getBoss = async (): Promise<PgBoss> => {
  if (boss) return boss;
  if (starting) return starting;

  starting = (async () => {
    const instance = new PgBoss({
      connectionString: env.engine.queueDatabaseUrl,
      // Keep the queue's tables out of the application schema so `prisma
      // migrate` never sees them as drift.
      schema: 'pgboss',
      // The app owns migrations; let pg-boss own its own schema.
      migrate: true,
    });

    instance.on('error', (err: Error) => logger.error('pg-boss error', { error: err.message }));

    await instance.start();

    // v10+ requires queues to exist before anything is sent to them.
    for (const name of Object.values(QUEUES)) {
      await instance.createQueue(name, QUEUE_POLICIES[name]);
    }

    boss = instance;
    logger.info('Job queue started', { queues: Object.values(QUEUES).length });
    return instance;
  })();

  return starting;
};

export const stopQueue = async (): Promise<void> => {
  if (!boss) return;
  await boss.stop({ graceful: true, timeout: 10_000 });
  boss = null;
  starting = null;
  logger.info('Job queue stopped');
};

// ── Typed send / work ─────────────────────────────────────────────────────────

export const enqueue = async <K extends QueueName>(
  queue: K,
  data: JobPayloads[K],
  options: Parameters<PgBoss['send']>[2] = {},
): Promise<string | null> => {
  const instance = await getBoss();
  return instance.send(queue, data as object, options);
};

/**
 * Longest a single job may run before the worker stops waiting for it.
 *
 * Deliberately larger than any queue's `expireInSeconds`, so pg-boss's own expiry is what
 * normally decides a job's fate. This is the backstop for the case pg-boss cannot see: a handler
 * whose promise never settles at all.
 */
const HANDLER_DEADLINE_MS = 240_000;

/**
 * Reject if a handler never settles.
 *
 * The failure this exists for: `Promise.all` over a batch, inside a poll loop that awaits it.
 * A `try/catch` catches a *rejected* promise; nothing catches one that simply never resolves. So
 * a single socket stalled against an external service (Meta, OpenAI) used to stop the queue
 * fetching **for every tenant** until the process was restarted, and `expireInSeconds` could not
 * help — it marks the row expired in Postgres, which cannot cancel an `await` inside Node.
 *
 * The timer is `unref`'d so a pending deadline never holds the process open during shutdown, and
 * cleared on the normal path so a long-lived worker does not accumulate timers.
 */
const withDeadline = async <T>(work: Promise<T>, label: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} did not settle within ${HANDLER_DEADLINE_MS}ms`)),
      HANDLER_DEADLINE_MS,
    );
    timer.unref();
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/**
 * Register a handler.
 *
 * pg-boss v12 hands the handler a batch. Each job is settled individually via
 * `perJobResults`, so one poison message cannot fail the whole batch and cause
 * its healthy neighbours to be retried.
 *
 * Note what the deadline does and does not do. It frees the *worker* so the queue keeps serving
 * every other tenant; it cannot abort the orphaned work, which carries on until whatever it is
 * waiting on gives up. That is why the individual clients have their own timeouts too — this is
 * the layer that stops one tenant's stall becoming everyone's outage, not the primary control.
 */
export const registerWorker = async <K extends QueueName>(
  queue: K,
  handler: (data: JobPayloads[K], job: Job<JobPayloads[K]>) => Promise<void>,
  options: {
    batchSize?: number;
    pollingIntervalSeconds?: number;
    localConcurrency?: number;
    burstWhenBatchFull?: boolean;
  } = {},
): Promise<void> => {
  const instance = await getBoss();

  await instance.work<JobPayloads[K]>(
    queue,
    {
      batchSize: options.batchSize ?? 1,
      pollingIntervalSeconds: options.pollingIntervalSeconds ?? 2,
      // pg-boss defaults this to 1 — a single poll loop per queue, which is what capped inbound
      // throughput regardless of `batchSize`. Callers that have somewhere to put the parallelism
      // (and a connection pool sized for it) opt in.
      ...(options.localConcurrency ? { localConcurrency: options.localConcurrency } : {}),
      // Without this, a fetch that returns a full batch still waits the polling interval before
      // the next one — so draining a backlog spent most of its time asleep.
      ...(options.burstWhenBatchFull ? { burstWhenBatchFull: true } : {}),
      perJobResults: true,
    },
    async (jobs: Job<JobPayloads[K]>[]): Promise<JobResult[]> => Promise.all(jobs.map(async (job) => {
      try {
        await withDeadline(handler(job.data, job), `${queue} job ${job.id}`);
        return { id: job.id, status: 'completed' as const };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('Job failed', { queue, jobId: job.id, error: message });
        return { id: job.id, status: 'failed' as const, output: { message } };
      }
    })),
  );

  logger.debug('Worker registered', { queue });
};

/**
 * Periodic maintenance. These are the only cron-style entries, and both exist
 * to stop state accumulating rather than to do primary work.
 */
export const scheduleMaintenance = async (): Promise<void> => {
  const instance = await getBoss();
  // Every 5 minutes: pick up delays whose time has come. A poll rather than an
  // in-process timer, so a restart mid-delay does not abandon the wait.
  await instance.schedule(QUEUES.resumeDelayedWorkflow, '*/5 * * * *', {}, { singletonKey: 'sweep' });
  // Hourly: release conversations wedged by an instance nobody will answer.
  await instance.schedule(QUEUES.expireStaleInstances, '0 * * * *', {}, { singletonKey: 'sweep' });
  // Hourly is enough: a scheduled downgrade is due at a period boundary, and
  // being at most an hour late means the customer keeps the higher plan
  // slightly longer — an error in their favour, which is the right direction.
  await instance.schedule(QUEUES.applyPlanChanges, '5 * * * *', {}, { singletonKey: 'plan-changes' });
  // Every 5 minutes: mark lead reminders that have come due, so the in-app
  // badge is never more than five minutes stale. Cheap — one indexed query over
  // open reminders whose time has passed and that have not been marked yet.
  await instance.schedule(QUEUES.sweepDueReminders, '*/5 * * * *', {}, { singletonKey: 'reminders' });
  // Every minute: send the next slice of each running campaign.
  //
  // A paced sweep rather than a job per recipient. Ten thousand recipients would
  // otherwise enqueue ten thousand rows the instant a campaign starts, pausing
  // would mean cancelling all of them, and the burst would compete with the
  // inbound queue that real customer messages arrive on — which matters more
  // than finishing a promotion a minute sooner. `singletonKey` keeps exactly one
  // sweep in flight, so two workers cannot both send the same batch.
  await instance.schedule(QUEUES.sendCampaignBatches, '* * * * *', {}, { singletonKey: 'campaigns' });
};
