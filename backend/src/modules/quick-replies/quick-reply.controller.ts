import type { Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { holds, tenantIdOf } from '../../middleware/auth.js';
import {
  allQuickReplies, createQuickReply, deleteQuickReply, quickReplyOf, sendableQuickReplies,
  updateQuickReply,
} from './quick-reply.service.js';

// Saved replies: the HTTP half.
//
// **A set with no answers is a plain-text frequent reply; one with answers is a question.** Same row,
// same route, and the presence of `buttons` is the whole distinction — see the model comment.
//
// The validation here is Meta's, not ours, and getting it wrong is not a validation error — it is a
// send that WhatsApp silently mangles or refuses. Three buttons maximum; twenty characters a label,
// past which Meta truncates without telling anybody.
//
// **The body limit depends on the kind**, so only its outer bound lives here: 4000, the same 4000
// `sendMessageValidator` accepts for a text reply, deliberately, so nothing saveable is unsendable.
// The 1024 an interactive message allows is enforced in the service, because on a PATCH the kind can
// come from the row rather than the request and a validator cannot see the row.

const idParam = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requireId = (value: string | undefined): string => {
  if (!value || !idParam.test(value)) throw ApiError.badRequest('Not a set id');
  return value;
};

/**
 * One answer.
 *
 * **`.strict()` matters here specifically.** The client must not send an `id` — ids are minted by
 * the server from the row, and an id an agent could choose is an id that can collide with the
 * ordering flow's prefixes or an operator's payload rule. Silently dropping one would leave a
 * client author wondering why theirs vanished; this way they find out.
 */
const buttonSchema = z.object({
  label: z.string().trim().min(1, 'A button needs a label').max(20, 'WhatsApp allows 20 characters on a button'),
  workflowId: z.string().uuid().nullable().optional(),
}).strict();

/**
 * The answers, of which there may be none.
 *
 * **There is no floor, and that absence is the feature.** The floor was the only thing that made a
 * plain-text frequent reply impossible — the database has always permitted zero buttons, and the
 * composer has always loaded a saved body into the reply field. Re-adding a `.min(1)` here removes
 * plain replies from the product.
 */
const buttonsSchema = z.array(buttonSchema)
  .max(3, 'WhatsApp allows at most three reply buttons')
  .refine(
    (buttons) => new Set(buttons.map((b) => b.label.toLowerCase())).size === buttons.length,
    // Meta rejects duplicate ids outright, and two identical pills in the transcript leave nobody
    // able to say which one the customer pressed.
    { message: 'Two answers cannot read the same' },
  );

const nameSchema = z.string().trim().min(1, 'A set needs a name').max(80);
const bodySchema = z.string().trim().min(1, 'A saved reply cannot be empty')
  .max(4000, 'WhatsApp allows 4000 characters in a text message');

const createSchema = z.object({
  name: nameSchema,
  body: bodySchema,
  // Absent means none, so `{ name, body }` saves a plain reply — the common case, and the one an
  // operator reaches for most.
  buttons: buttonsSchema.default([]),
}).strict();

const updateSchema = z.object({
  name: nameSchema.optional(),
  body: bodySchema.optional(),
  isActive: z.boolean().optional(),
  buttons: buttonsSchema.optional(),
}).strict().refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update' });

/**
 * The sets in this workspace.
 *
 * **Two audiences, one route.** Somebody who may only send (`inbox:reply`) gets the sets they can
 * actually send — active ones. Somebody who may configure them (`automation:write`) gets all of
 * them, retired included, because that is the list they manage. A second endpoint for the same rows
 * would be two things to keep in step.
 */
export const getQuickReplies = asyncHandler(async (req: Request, res: Response) => {
  const canManage = holds(req, 'automation:write');
  const sets = canManage
    ? await allQuickReplies(tenantIdOf(req))
    : await sendableQuickReplies(tenantIdOf(req));
  res.json({ success: true, data: sets });
});

export const getQuickReply = asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await quickReplyOf(tenantIdOf(req), requireId(req.params.id)) });
});

export const postQuickReply = asyncHandler(async (req: Request, res: Response) => {
  const body = createSchema.parse(req.body ?? {});
  res.status(201).json({ success: true, data: await createQuickReply(tenantIdOf(req), body) });
});

export const patchQuickReply = asyncHandler(async (req: Request, res: Response) => {
  const body = updateSchema.parse(req.body ?? {});
  const set = await updateQuickReply(tenantIdOf(req), requireId(req.params.id), body);
  res.json({ success: true, data: set });
});

export const deleteQuickReplyHandler = asyncHandler(async (req: Request, res: Response) => {
  await deleteQuickReply(tenantIdOf(req), requireId(req.params.id));
  res.json({ success: true, data: { deleted: true } });
});
