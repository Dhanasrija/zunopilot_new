import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { env } from './config/env.js';
import { prisma } from './config/prisma.js';
import { httpLoggerStream, logger } from './config/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { routes } from './routes/index.js';
import { publicMediaRoutes } from './modules/media/media.routes.js';

export const buildApp = (): Express => {
  const app = express();

  // Trust exactly one proxy hop — the nginx in front of this app.
  //
  // Without this, `req.ip` is nginx's address for every request, so the global
  // rate limiter below treats all traffic from all users of all tenants as a
  // single client and starts 429-ing everyone at 300 requests a minute. It is
  // an accidental denial of service against your own users, and it only shows
  // up once there is a proxy in front — which is why express-rate-limit warns
  // loudly when it sees X-Forwarded-For with this unset.
  //
  // `1`, not `true`: trusting every hop lets a client spoof X-Forwarded-For to
  // present a fresh IP per request and walk straight through the limiter.
  app.set('trust proxy', 1);

  app.use(helmet());

  /*
   * CORS, restricted to the origins this API is actually served to.
   *
   * It used to be a bare `cors()`, which reflects whatever `Origin` it is given. That was
   * never the dramatic hole it looks like — sessions are a bearer token in a header, not a
   * cookie, so a hostile page cannot ride an existing session the way it could with
   * `credentials: true` — but "any website may read our JSON if it obtains a token" is not a
   * property worth keeping, and `frontendUrl` was already sitting in the config for exactly
   * this.
   *
   * No `Origin` header at all is allowed through: that is every server-to-server caller,
   * curl, and Meta's webhook. CORS is a browser control, and refusing those would break the
   * webhook while stopping nothing.
   */
  const allowedOrigins = new Set([env.frontendUrl, env.superAdmin.origin, env.appUrl]);
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      logger.warn('Blocked a cross-origin request from an unknown origin', { origin });
      return callback(null, false);
    },
  }));

  /*
   * A request id on every request, echoed in the response and carried into the logs.
   *
   * Honours an inbound `X-Request-Id` so a proxy's id wins and one identifier spans the whole
   * hop; generates one otherwise. This is the smallest thing that makes "a customer says
   * saving failed at about 3pm" answerable — before it, nothing tied a user's report to a
   * line in the log.
   */
  app.use((req, res, next) => {
    const inbound = req.get('x-request-id');
    const id = inbound && /^[\w-]{1,128}$/.test(inbound) ? inbound : randomUUID();
    (req as express.Request & { requestId?: string }).requestId = id;
    res.setHeader('X-Request-Id', id);
    next();
  });
  // The raw body is kept alongside the parsed one so the WhatsApp webhook can
  // verify Meta's X-Hub-Signature-256, which is computed over the exact bytes
  // sent — re-serialising the parsed JSON would produce a different digest.
  app.use(express.json({
    limit: '2mb',
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }));
  app.use(express.urlencoded({ extended: true }));
  app.use(morgan('dev', { stream: httpLoggerStream }));

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    // A test run fires hundreds of requests in seconds; rate limiting them
    // would only test the rate limiter.
    skip: () => env.isTest,
  });
  app.use('/api', apiLimiter);

  /*
   * Health, meaning "can this instance actually serve a request".
   *
   * It used to return 200 unconditionally, which is the one answer a load balancer must
   * never be given wrongly: an instance whose database connection is gone reported itself
   * healthy and kept receiving traffic, so every request it took returned a 500. A liveness
   * check that cannot fail is decoration.
   *
   * `SELECT 1` and nothing more. The point is to exercise the connection pool, not to audit
   * the schema — a health check that runs real queries becomes a load source of its own, and
   * one that touches many subsystems fails for reasons that are not this instance's fault.
   * pg-boss is deliberately not checked: workers are optional in this process
   * (`RUN_WORKERS_IN_API`), so a queue problem must not take the API out of rotation.
   */
  app.get('/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', uptime: process.uptime() });
    } catch (err) {
      logger.error('Health check failed: the database is unreachable', {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(503).json({ status: 'unavailable', uptime: process.uptime() });
    }
  });

  app.use('/api', routes);

  /*
   * Template media, served unauthenticated and outside `/api`.
   *
   * Meta fetches header media from its own servers when a template is sent, and cannot
   * present a token — so this route must be open. It is mounted here rather than under the
   * API so it sits outside `apiLimiter` too: Meta may fetch the same asset once per
   * recipient, and a campaign to several hundred people would otherwise rate-limit itself.
   * The uuid in the path is the capability; see the `MediaAsset` comment in schema.prisma.
   */
  app.use('/media', publicMediaRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
