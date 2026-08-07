import { buildApp } from './app.js';
import { env, jwtSecretWeakness } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './config/prisma.js';
import { reportStorageAtBoot } from './modules/media/storage.js';
import { startResumeWorker, stopResumeWorker } from './services/workflow-engine/resume-worker.js';
import { startWorkers } from './modules/conversation-engine/jobs/workers.js';
import { stopQueue } from './modules/conversation-engine/jobs/queue.js';

// Fail closed and loudly, before anything binds a port.
//
// Every session in the product is a token signed with this secret, so a weak one is not a
// degraded state — it is an open door for every tenant at once. Refusing to start is the
// only honest response: booting and then rejecting logins would read as a broken password,
// and booting with a guessable secret reads as nothing at all until it is exploited.
//
// `config/env.ts` throws at import when JWT_SECRET is missing entirely; this covers the
// present-but-too-short case, which no exception would catch.
const weakness = jwtSecretWeakness();
if (weakness) {
  logger.error(
    `${weakness}. The API will not start. Generate one with: openssl rand -base64 48`,
  );
  process.exit(1);
}

/*
 * Where media goes — reported at boot, but **not** a reason to refuse to boot.
 *
 * Unlike the secret above, this one does not `process.exit(1)`, and that is a correction. It
 * used to: a production server with no `S3_BUCKET` would have written customer photographs
 * into the release directory that the next deploy replaces, so exiting looked like the
 * cautious choice. It was not. The variable went missing once and took down messaging,
 * billing and the console with it — the health gate failed, the deploy rolled back, and the
 * blast radius of a file-storage setting was the entire product.
 *
 * The data is still protected: `storage.ts` refuses every read and write rather than falling
 * back to disk, so nothing is quietly lost. What changed is that the refusal is scoped to the
 * thing that is broken.
 */
reportStorageAtBoot();

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
