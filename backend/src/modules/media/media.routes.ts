import { Router } from 'express';
import multer from 'multer';
import { queryEnum } from '../../utils/query.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { requireAuth, requirePermission, tenantIdOf, userOf } from '../../middleware/auth.js';
import {
  MAX_UPLOAD_BYTES, deleteMedia, listMedia, mediaRules, openForServing, openForTenant,
  publicUrlIsReachable, storeUpload,
} from './media.service.js';

// Media for template headers.
//
// Two routers, because they have opposite audiences and must not share middleware:
//
//   • `mediaRoutes` — authenticated, under `/api/media`. The operator's library.
//   • `publicMediaRoutes` — **unauthenticated**, mounted at `/media`. Meta fetches template
//     media itself and cannot present a token, so this route has to be open. See the model
//     comment in schema.prisma; the uuid in the path is the capability.
//
// **What a customer sends is not served by the public router.** `MediaAsset.source` is
// `INBOUND` for those, `openForServing` refuses them, and `/api/media/:id/file` below hands
// them over only to somebody signed in to the workspace that received them. The two are
// deliberately different routes rather than one with a flag, because a flag is a thing
// somebody eventually gets backwards.

/**
 * In memory, not to a temp file.
 *
 * The service writes the bytes itself under a uuid it generates. Letting multer choose a
 * destination would mean a second place that decides where uploads land, and the disk path
 * is exactly the thing worth having only one of.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  // The largest any kind allows. The per-kind ceiling is applied in the service, which
  // knows which kind the MIME type implies — this is only the outer stop so a huge body is
  // not buffered before anyone looks at it.
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

export const mediaRoutes = Router();
mediaRoutes.use(requireAuth);

/**
 * What can be uploaded, so the picker can say so before somebody tries.
 *
 * Also reports whether `APP_URL` is reachable from outside. In development it is
 * `http://localhost:4000`, which Meta cannot fetch — better to say that on the screen than
 * to let every send fail with a media download error nobody can trace.
 */
mediaRoutes.get('/rules', requirePermission('campaigns:read'), asyncHandler(async (_req, res) => {
  res.json({
    success: true,
    data: {
      kinds: mediaRules,
      publicUrlReachable: publicUrlIsReachable(),
    },
  });
}));

mediaRoutes.get('/', requirePermission('campaigns:read'), asyncHandler(async (req, res) => {
  const kind = queryEnum(req.query.kind, ['IMAGE', 'VIDEO', 'DOCUMENT'] as const);
  res.json({ success: true, data: await listMedia(tenantIdOf(req), kind) });
}));

mediaRoutes.post(
  '/',
  requirePermission('campaigns:write'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('No file was uploaded');
    const asset = await storeUpload({
      tenantId: tenantIdOf(req),
      uploadedByUserId: userOf(req).id,
      originalName: req.file.originalname,
      // Trusted only as a hint — `kindForMime` decides what slot it can fill, and an
      // unrecognised type is refused rather than guessed at.
      mimeType: req.file.mimetype,
      buffer: req.file.buffer,
    });
    res.status(201).json({ success: true, data: asset });
  }),
);

mediaRoutes.delete('/:id', requirePermission('campaigns:write'), asyncHandler(async (req, res) => {
  await deleteMedia(tenantIdOf(req), req.params.id!);
  res.json({ success: true, data: { deleted: true } });
}));

/**
 * The bytes of something a customer sent us.
 *
 * Authenticated and tenant-scoped: `openForTenant` puts the tenant in the `where`, so there is
 * no version of this that returns another workspace's customer's photograph. `inbox:read`
 * rather than a media permission — if you can read the conversation you can see what was sent
 * in it, and any other answer would show an agent a message they cannot open.
 *
 * Streamed from S3 through this process rather than redirecting to a presigned URL. It costs
 * bandwidth, and it buys a URL that stops working the moment the session does, instead of one
 * that keeps working for anyone who has it until it expires.
 */
mediaRoutes.get('/:id/file', requirePermission('inbox:read'), asyncHandler(async (req, res) => {
  const asset = await openForTenant(tenantIdOf(req), req.params.id!);
  if (!asset) throw ApiError.notFound('Media not found');

  res.setHeader('Content-Type', asset.mimeType);
  res.setHeader('Content-Length', String(asset.sizeBytes));
  // Private: this is one customer's file, and no shared cache should hold it.
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(asset.originalName)}"`);

  asset.stream().pipe(res);
}));

// ── Public ────────────────────────────────────────────────────────────────────

export const publicMediaRoutes = Router();

/**
 * Serve the bytes to whoever has the URL — in practice, Meta.
 *
 * The filename segment is decoration so a download has a sensible name; it is ignored when
 * locating the file, which comes only from the id.
 */
publicMediaRoutes.get('/:id/:filename?', asyncHandler(async (req, res) => {
  const asset = await openForServing(req.params.id!);
  if (!asset) throw ApiError.notFound('Media not found');

  res.setHeader('Content-Type', asset.mimeType);
  res.setHeader('Content-Length', String(asset.sizeBytes));
  // Immutable: the bytes behind an id never change, so Meta and any CDN in between may
  // cache freely.
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  // `nosniff` matters more than usual here — this route returns operator-supplied bytes to
  // an anonymous caller, and must never be coaxed into serving them as HTML.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(asset.originalName)}"`);

  asset.stream().pipe(res);
}));
