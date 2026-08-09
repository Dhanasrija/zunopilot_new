import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { ApiError } from '../../utils/ApiError.js';

// Saved reply-button sets: the data half.
//
// Two rules live here rather than in the controller, because both are about the database and both
// would be easy to leave out of one of the two write paths:
//
//   • **A workflow may only be bound if it is published and belongs to this workspace.** Checked
//     against the table, not taken on trust — a workflow id is a uuid an agent could paste.
//   • **Buttons are replaced wholesale on an update, never patched.** See `writeButtons`.

/** What the composer and the editor both read. Buttons in the order they will be shown. */
const SET_SHAPE = {
  buttons: {
    orderBy: { position: 'asc' as const },
    select: {
      id: true,
      label: true,
      position: true,
      workflowId: true,
      // The name, so the editor and the composer can say *which* workflow without a second read.
      // `status` too: a set whose workflow has since been unpublished must be able to say so,
      // because the tap will not start it.
      workflow: { select: { id: true, name: true, status: true } },
    },
  },
} satisfies Prisma.QuickReplyInclude;

export interface ButtonInput {
  label: string;
  workflowId?: string | null;
}

/**
 * Refuse a workflow this workspace may not bind to.
 *
 * `PUBLISHED` and not merely present: binding a draft would mean an agent's button starts a
 * half-built flow on a live customer the moment somebody taps it. The inbound handler checks the
 * status again at tap time, because a workflow can be unpublished after the binding is made — this
 * check is the one that gives an operator an error message instead of a surprise.
 */
const assertBindable = async (tenantId: string, buttons: ButtonInput[]): Promise<void> => {
  const ids = [...new Set(buttons.map((b) => b.workflowId).filter((id): id is string => !!id))];
  if (!ids.length) return;

  const found = await prisma.workflow.findMany({
    where: { id: { in: ids }, tenantId, status: 'PUBLISHED' },
    select: { id: true },
  });
  if (found.length === ids.length) return;

  const missing = ids.filter((id) => !found.some((w) => w.id === id));
  throw ApiError.badRequest(
    missing.length === ids.length && ids.length === 1
      ? 'That workflow is not published, so a button cannot start it yet'
      : 'One of those workflows is not published, so a button cannot start it yet',
  );
};

/**
 * Write a set's buttons, replacing whatever was there.
 *
 * **Delete-then-create, deliberately, and it is not a shortcut.** A button's row id *is* its
 * identity on WhatsApp, so editing a label in place would silently change what a tap on an already
 * sent question means: the customer sees "Delivery" on their phone and taps it, and the row now
 * says "Pickup". Replacing the rows makes the old ids resolve to nothing instead, which the inbound
 * handler already treats as "record it and let the agent answer" — the honest outcome for a
 * question whose answers have been rewritten.
 *
 * The cost is that a set cannot be renamed without retiring its outstanding buttons. That is the
 * right trade: the alternative is a customer's tap meaning something they never agreed to.
 */
const writeButtons = async (
  tx: Prisma.TransactionClient, quickReplyId: string, buttons: ButtonInput[],
): Promise<void> => {
  await tx.quickReplyButton.deleteMany({ where: { quickReplyId } });
  await tx.quickReplyButton.createMany({
    data: buttons.map((button, position) => ({
      quickReplyId,
      label: button.label,
      position,
      workflowId: button.workflowId ?? null,
    })),
  });
};

/** Every set in the workspace, newest configuration order first. */
export const allQuickReplies = (tenantId: string) => prisma.quickReply.findMany({
  where: { tenantId },
  orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  include: SET_SHAPE,
});

/** The ones an agent may actually send. Retired sets stay readable in the editor and not here. */
export const sendableQuickReplies = (tenantId: string) => prisma.quickReply.findMany({
  where: { tenantId, isActive: true },
  orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  include: SET_SHAPE,
});

export const quickReplyOf = async (tenantId: string, id: string) => {
  const set = await prisma.quickReply.findFirst({ where: { id, tenantId }, include: SET_SHAPE });
  if (!set) throw ApiError.notFound('That set of replies does not exist');
  return set;
};

export const createQuickReply = async (tenantId: string, input: {
  name: string; body: string; buttons: ButtonInput[];
}) => {
  await assertBindable(tenantId, input.buttons);

  try {
    return await prisma.quickReply.create({
      data: {
        tenantId,
        name: input.name,
        body: input.body,
        buttons: {
          create: input.buttons.map((button, position) => ({
            label: button.label, position, workflowId: button.workflowId ?? null,
          })),
        },
      },
      include: SET_SHAPE,
    });
  } catch (err) {
    // The name is how an agent picks a set out of a list, so two that read the same is a set
    // nobody can choose deliberately. Named rather than surfaced as a constraint violation.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw ApiError.badRequest('A set of replies with that name already exists');
    }
    throw err;
  }
};

export const updateQuickReply = async (tenantId: string, id: string, input: {
  name?: string; body?: string; isActive?: boolean; buttons?: ButtonInput[];
}) => {
  // Scoped read first: a uuid from a request is not proof of ownership.
  await quickReplyOf(tenantId, id);
  if (input.buttons) await assertBindable(tenantId, input.buttons);

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.quickReply.update({
        where: { id },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.body === undefined ? {} : { body: input.body }),
          ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
        },
      });
      if (input.buttons) await writeButtons(tx, id, input.buttons);

      return tx.quickReply.findUniqueOrThrow({ where: { id }, include: SET_SHAPE });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw ApiError.badRequest('A set of replies with that name already exists');
    }
    throw err;
  }
};

/**
 * Remove a set.
 *
 * The buttons cascade, and any tap that arrives afterwards resolves to nothing — which the inbound
 * handler records and leaves to the agent. Retiring with `isActive: false` is the gentler option
 * and the one the UI offers first; this is here for a set created by mistake.
 */
export const deleteQuickReply = async (tenantId: string, id: string): Promise<void> => {
  await quickReplyOf(tenantId, id);
  await prisma.quickReply.delete({ where: { id } });
};
