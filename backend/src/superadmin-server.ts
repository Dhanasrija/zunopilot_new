import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './config/prisma.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { superAdminRoutes } from './modules/super-admin/routes.js';
import { superAdminConfigured } from './modules/super-admin/auth.js';

// The super admin API, as its own process on its own port.
//
// Separate rather than another router on :4000, for three reasons that are all
// operational rather than stylistic:
//
//   1. **It can be firewalled.** Bind it to a private interface, put it behind a
//      VPN, or restrict it by security group without touching the API that has to
//      stay reachable by Meta and by every customer's browser.
//   2. **Its blast radius is bounded.** An operator running a heavy report cannot
//      exhaust the request pool that inbound WhatsApp webhooks are queueing
//      through — a dropped webhook is a lost customer message.
//   3. **A path mistake cannot expose it.** There is no `/sa` prefix on the
//      public app that a misordered `app.use` could reveal, because the routes
//      are not mounted there at all.
//
// It deliberately does **not** start the job workers. Two processes both running
// `expire-stale-instances` would double-sweep, and this process has no business
// touching a customer's live conversations.

export const buildSuperAdminApp = () => {
  const app = express();

  // Behind nginx in every real deployment, and the rate limiters below are
  // useless without it — every request would look like one client.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());

  // Only the admin UI's own origin, unlike the customer API's open CORS. An
  // operator console is not a public API and has no third-party callers.
  app.use(cors({ origin: env.superAdmin.origin, credentials: true }));
  app.use(express.json({ limit: '256kb' }));

  app.use(rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
  }));

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      surface: 'super-admin',
      configured: superAdminConfigured(),
      uptime: process.uptime(),
    });
  });

  app.use('/sa', superAdminRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

// Started only when this file is the entry point, so tests can import the app
// without binding a port.
const isEntry = process.argv[1]?.includes('superadmin-server');

if (isEntry) {
  // Fail closed and loudly. A console that can read every workspace must never
  // come up with a weak or absent signing secret — starting anyway and refusing
  // logins later would look like a broken password rather than a misconfiguration.
  if (!superAdminConfigured()) {
    logger.error(
      'SUPERADMIN_JWT_SECRET is missing or shorter than 32 characters. '
      + 'The super admin API will not start. Generate one with: openssl rand -base64 48',
    );
    process.exit(1);
  }

  const app = buildSuperAdminApp();
  const server = app.listen(env.superAdmin.port, () => {
    logger.info(`Super admin API listening on http://localhost:${env.superAdmin.port} (env=${env.nodeEnv})`);
  });

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down the super admin API...`);
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
