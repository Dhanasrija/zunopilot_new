import { Router } from 'express';
import {
  listKeywordRules,
  createKeywordRule,
  updateKeywordRule,
  deleteKeywordRule,
  getFallback,
  updateFallback,
} from '../controllers/automation.controller.js';
import {
  createKeywordValidator, updateKeywordValidator, fallbackValidator,
} from '../validators/automation.validator.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, requireModule, requirePermission } from '../middleware/auth.js';

// Auto-replies: the workspace's keyword rules, and the line a customer gets when nothing
// matched.
//
// ── Why the module gate is per-route here, and nowhere else ──────────────────────────────
//
// Every other module mounts `requireModule` once with `router.use(...)`, and that convention
// exists for a good reason: a module where three endpoints forgot the gate is not gated. This
// router is the deliberate exception, so please do not "tidy" it into a `router.use`.
//
// It serves two different things. `KEYWORD_RULES` gates the workspace's FAQ answers — an
// operator switch, off for a business whose conversations all run through workflows. The
// **fallback message is not gated**, because it is what a customer receives when nothing
// matched, which every workspace needs whether or not it has a single keyword rule. Gating it
// too would leave a workspace stuck with a built-in default it cannot change — and a seeded
// restaurant line reading "Type 'Menu' to order" on a business that does not take orders is the
// exact complaint this module came from.

const router = Router();
router.use(requireAuth);

// ── Keyword rules — behind the module ─────────────────────────────────────────
router.get(
  '/keywords',
  requireModule('KEYWORD_RULES'),
  requirePermission('automation:write'),
  listKeywordRules,
);
router.post(
  '/keywords',
  requireModule('KEYWORD_RULES'),
  requirePermission('automation:write'),
  createKeywordValidator, validate, createKeywordRule,
);
router.patch(
  '/keywords/:id',
  requireModule('KEYWORD_RULES'),
  requirePermission('automation:write'),
  updateKeywordValidator, validate, updateKeywordRule,
);
router.delete(
  '/keywords/:id',
  requireModule('KEYWORD_RULES'),
  requirePermission('automation:write'),
  deleteKeywordRule,
);

// ── The fallback message — always available ───────────────────────────────────
router.get('/fallback', requirePermission('automation:write'), getFallback);
router.put('/fallback', requirePermission('automation:write'), fallbackValidator, validate, updateFallback);

export default router;
