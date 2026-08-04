import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { httpLoggerStream } from './config/logger.js';
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
  app.use(cors());
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

  app.get('/health', (_req, res) => { res.json({ status: 'ok', uptime: process.uptime() }); });

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
