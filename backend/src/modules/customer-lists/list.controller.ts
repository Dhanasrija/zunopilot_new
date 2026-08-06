import type { Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { tenantIdOf, userOf } from '../../middleware/auth.js';
import { queryInt, queryOffset } from '../../utils/query.js';
import { maskContact } from '../../utils/mask-number.js';
import { maySeeFullNumbers } from '../../utils/may-see-numbers.js';
import {
  addMembers, allLists, createList, deleteList, listMembers, listOf, removeMembers,
  updateList,
} from './list.service.js';

const idParam = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requireId = (value: string | undefined, what: string): string => {
  if (!value || !idParam.test(value)) throw ApiError.badRequest(`Not a ${what} id`);
  return value;
};

const nameSchema = z.string().trim().min(1, 'A list needs a name').max(80);

const createSchema = z.object({
  name: nameSchema,
  description: z.string().trim().max(500).optional(),
});

const updateSchema = z.object({
  name: nameSchema.optional(),
  description: z.string().trim().max(500).nullable().optional(),
}).refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update' });

/**
 * A bulk membership change.
 *
 * Capped at 500 per request: the Customers page selects a page at a time, so nothing
 * legitimate approaches it, and an unbounded array is an easy way to hold a connection
 * open. `.min(1)` because an empty change is a mistake worth naming rather than a
 * successful no-op.
 */
const membersSchema = z.object({
  customerIds: z.array(z.string().uuid()).min(1, 'Pick at least one customer').max(500),
});

export const getLists = asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await allLists(tenantIdOf(req)) });
});

export const getList = asyncHandler(async (req: Request, res: Response) => {
  const id = requireId(req.params.id, 'list');
  res.json({ success: true, data: await listOf(tenantIdOf(req), id) });
});

export const postList = asyncHandler(async (req: Request, res: Response) => {
  const body = createSchema.parse(req.body ?? {});
  const list = await createList(tenantIdOf(req), {
    ...body,
    createdByUserId: userOf(req).id,
  });
  res.status(201).json({ success: true, data: list });
});

export const patchList = asyncHandler(async (req: Request, res: Response) => {
  const id = requireId(req.params.id, 'list');
  const body = updateSchema.parse(req.body ?? {});
  res.json({ success: true, data: await updateList(tenantIdOf(req), id, body) });
});

export const deleteListHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = requireId(req.params.id, 'list');
  await deleteList(tenantIdOf(req), id);
  // Said plainly in the response, because "deleted" next to a list of people is exactly
  // where someone fears the worst.
  res.json({ success: true, data: { deleted: true, customersKept: true } });
});

export const getListMembers = asyncHandler(async (req: Request, res: Response) => {
  const id = requireId(req.params.id, 'list');
  const take = queryInt(req.query.take, 50);
  const skip = queryOffset(req.query.skip);
  const { members, total } = await listMembers(tenantIdOf(req), id, { take, skip });
  // A curated list is exactly the shape someone exfiltrating contacts would reach for, so
  // it is masked like everything else.
  const seeFull = await maySeeFullNumbers(req);
  res.json({
    success: true,
    data: members.map((member) => ({ ...member, customer: maskContact(member.customer, seeFull) })),
    meta: { total, take, skip },
  });
});

export const postListMembers = asyncHandler(async (req: Request, res: Response) => {
  const id = requireId(req.params.id, 'list');
  const { customerIds } = membersSchema.parse(req.body ?? {});
  const result = await addMembers(tenantIdOf(req), id, customerIds, userOf(req).id);
  res.json({ success: true, data: result });
});

export const deleteListMembers = asyncHandler(async (req: Request, res: Response) => {
  const id = requireId(req.params.id, 'list');
  const { customerIds } = membersSchema.parse(req.body ?? {});
  res.json({ success: true, data: await removeMembers(tenantIdOf(req), id, customerIds) });
});
