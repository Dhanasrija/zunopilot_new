import { buildApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './config/prisma.js';
import { startResumeWorker, stopResumeWorker } from './services/workflow-engine/resume-worker.js';
import { startWorkers } from './modules/conversation-engine/jobs/workers.js';
import { stopQueue } from './modules/conversation-engine/jobs/queue.js';

const app = buildApp();

// Module 11's resume worker. Picks up runs parked on a Delay node by polling the
// database rather than using in-process timers, so a restart does not abandon
// in-flight waits. Retired once the Module 12 engine takes over its graphs.
startResumeWorker();

// Module 12 job workers. Off by default in a separate-worker-process deploy;
// a queue failure must not stop the API from serving, so it is logged and the
// server keeps running rather than crashing on boot.
if (env.engine.runWorkersInApi) {
  startWorkers().catch((err: Error) => {
    logger.error('Failed to start conversation engine workers', { error: err.message });
  });
}

const server = app.listen(env.port, () => {
  logger.info(`Server listening on ${env.appUrl} (env=${env.nodeEnv})`);
});

let shuttingDown = false;

const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received, shutting down...`);
  stopResumeWorker();
  server.close(async () => {
    // Drain in-flight jobs before the connection pool goes away, or a worker
    // mid-transaction leaves an instance stuck in RUNNING.
    await stopQueue().catch(() => {});
    await prisma.$disconnect();
    process.exit(0);
  });
  // Don't let a hung connection hold the process open forever.
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason });
});
process.on('uncaughtException', (err: Error) => {
  logger.error('Uncaught exception', { message: err.message, stack: err.stack });
  process.exit(1);
});
