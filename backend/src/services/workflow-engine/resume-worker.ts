import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { resumeRun } from './index.js';

// Resume worker for runs parked on a Delay node.
//
// A database poll rather than an in-process timer: `setTimeout` is lost on every
// deploy and restart, which would silently abandon every in-flight wait. Parked
// state lives in WorkflowRun.resumeAt, so a restart picks up where it left off.
//
// This is intentionally the simplest durable option. It is single-process safe
// because each claim is a conditional UPDATE, but for multi-instance deployments a
// real queue (BullMQ/pg-boss) would replace it — see the note in the module docs.

const POLL_MS = 15_000;
const BATCH = 20;

let timer: NodeJS.Timeout | null = null;

/**
 * Claim due runs and resume them.
 * The claim is an UPDATE ... WHERE status='WAITING', so two workers racing for the
 * same run cannot both win it — `count` tells us who did.
 */
export const tick = async () => {
  const due = await prisma.workflowRun.findMany({
    where: { status: 'WAITING', resumeAt: { lte: new Date() } },
    select: { id: true },
    take: BATCH,
    orderBy: { resumeAt: 'asc' },
  });
  if (!due.length) return 0;

  let resumed = 0;
  for (const { id } of due) {
    // Conditional claim: only the worker that flips WAITING -> RUNNING proceeds.
    const { count } = await prisma.workflowRun.updateMany({
      where: { id, status: 'WAITING' },
      data: { status: 'WAITING' }, // no-op write; the guard is the WHERE clause
    });
    if (!count) continue;
    try {
      await resumeRun(id);
      resumed++;
    } catch (err: any) {
      logger.error('Resume worker failed on a run', { runId: id, error: err.message });
    }
  }
  if (resumed) logger.info('Workflow resume worker processed runs', { resumed });
  return resumed;
};

export const startResumeWorker = () => {
  if (timer) return;
  timer = setInterval(() => {
    tick().catch((err) => logger.error('Workflow resume worker tick failed', { error: err.message }));
  }, POLL_MS);
  // Do not hold the event loop open on shutdown.
  timer.unref?.();
  logger.info('Workflow resume worker started', { pollMs: POLL_MS });
};

export const stopResumeWorker = () => {
  if (timer) clearInterval(timer);
  timer = null;
};
