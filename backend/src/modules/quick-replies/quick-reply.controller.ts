import type { Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { holds, tenantIdOf } from '../../middleware/auth.js';
import {
  allQuickReplies, createQuickReply, deleteQuickReply, quickReplyOf, sendableQuickReplies,
  updateQuickReply,
} from './quick-reply.service.js';

// Saved reply-button sets: the HTTP half.
//
// The validation here is Meta's, not ours, and getting it wrong is not a validation error — it is a
// send that WhatsApp silently mangles or refuses. Three buttons maximum; twenty characters a label,
// past which Meta truncates without telling anybody; and 1024 characters of body, which is the
// interactive limit and **not** the 4000 a plain text reply allows.

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

const buttonsSchema = z.array(buttonSchema)
  .min(1, 'A set needs at least one answer')
  .max(3, 'WhatsApp allows at most three reply buttons')
  .refine(
    (buttons) => new Set(buttons.map((b) => b.label.toLowerCase())).size === buttons.length,
    // Meta rejects duplicate ids outright, and two identical pills in the transcript leave nobody
    // able to say which one the customer pressed.
    { message: 'Two answers cannot read the same' },
  );

const nameSchema = z.string().trim().min(1, 'A set needs a name').max(80);
const bodySchema = z.string().trim().min(1, 'A question cannot be empty')
  .max(1024, 'WhatsApp allows 1024 characters in a question with buttons');

const createSchema = z.object({
  name: nameSchema,
  body: bodySchema,
  buttons: buttonsSchema,
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
