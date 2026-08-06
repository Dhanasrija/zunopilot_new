import { z } from 'zod';
import { prisma } from '../../../../config/prisma.js';
import { NODE_CONFIG_SCHEMAS } from '../../domain/node-types.js';
import { NodeConfigError, type ReplyOutcome, type WorkflowNodeExecutor } from '../types.js';

// Interactive nodes: tappable lists and reply buttons.
//
// These are what make an order flow buildable on the canvas — the catalogue,
// the item picker and the quantity chooser are all one of these two nodes with
// a different data source.
//
// Both park in WAITING_FOR_USER exactly as ASK_USER_INPUT does, and both
// implement `acceptReply`, which is what the generic resume path dispatches on.
// Neither knows anything about carts or orders; they collect a choice into a
// variable and the graph decides what that means.

type ListConfig = z.infer<typeof NODE_CONFIG_SCHEMAS.LIST_MESSAGE>;
type ButtonConfig = z.infer<typeof NODE_CONFIG_SCHEMAS.BUTTON_MESSAGE>;

/** WhatsApp's hard limits. Exceeding either makes Meta reject the whole send. */
const MAX_ROWS = 10;
const MAX_TITLE = 24;
const MAX_DESCRIPTION = 72;

const clip = (text: string, max: number) =>
  (text.length > max ? `${text.slice(0, max - 1)}…` : text);

interface Row { id: string; title: string; description?: string }

/**
 * Build the rows for a list, reading the tenant's live catalogue when asked.
 *
 * Ids are prefixed (`cat:`, `item:`) so a later CONDITION can branch on what
 * kind of thing was chosen, and so the id survives round-tripping through
 * WhatsApp as an opaque string.
 */
const rowsFor = async (
  config: ListConfig,
  tenantId: string,
  variables: Record<string, unknown>,
): Promise<Row[]> => {
  if (config.source === 'menu_categories') {
    const categories = await prisma.menuCategory.findMany({
      where: { tenantId, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      take: MAX_ROWS,
    });
    return categories.map((category) => ({
      id: `cat:${category.id}`,
      title: clip(category.name, MAX_TITLE),
      ...(category.description ? { description: clip(category.description, MAX_DESCRIPTION) } : {}),
    }));
  }

  if (config.source === 'menu_items') {
    // The category id arrives prefixed from a previous list tap; strip it back
    // off rather than making the author remember to.
    const raw = config.categoryVariable
      ? String(variables[config.categoryVariable] ?? '')
      : '';
    const categoryId = raw.startsWith('cat:') ? raw.slice(4) : raw;

    const items = await prisma.menuItem.findMany({
      where: { tenantId, inStock: true, ...(categoryId ? { categoryId } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      take: MAX_ROWS,
    });

    return items.map((item) => ({
      id: `item:${item.id}`,
      title: clip(item.name, MAX_TITLE),
      // Price belongs in the description, not the title: titles are capped at
      // 24 characters and the name should win that space.
      description: clip(
        `₹${Number(item.basePrice).toFixed(0)}${item.description ? ` · ${item.description}` : ''}`,
        MAX_DESCRIPTION,
      ),
    }));
  }

  if (config.source === 'variable') {
    // Rows produced upstream, normally by a CONNECTOR_QUERY. Read defensively:
    // whatever the far end returned has already been mapped, but a mapping can
    // be wrong and a half-formed row must not reach WhatsApp.
    const raw = config.itemsVariable ? variables[config.itemsVariable] : undefined;
    if (!Array.isArray(raw)) return [];

    return raw.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const row = entry as { id?: unknown; title?: unknown; description?: unknown };
      if (row.id === undefined || row.title === undefined) return [];
      return [{
        id: String(row.id),
        title: clip(String(row.title), MAX_TITLE),
        ...(row.description === undefined || row.description === null
          ? {}
          : { description: clip(String(row.description), MAX_DESCRIPTION) }),
      }];
    }).slice(0, MAX_ROWS);
  }

  return config.rows.map((row) => ({
    id: row.id,
    title: clip(row.title, MAX_TITLE),
    ...(row.description ? { description: clip(row.description, MAX_DESCRIPTION) } : {}),
  }));
};

/**
 * Shared reply handling for lists and buttons.
 *
 * Taps are matched on id; typing is matched on what the customer could actually
 * see — the row *title*. Matching typed text against ids is useless the moment
 * a list is built from the catalogue, because those ids are `cat:<uuid>`: no
 * human will ever type one, so every typed reply is rejected, the node
 * re-prompts, and after `maxRetries` the run hands off to a person. A customer
 * who answers "Biryani" to a menu is being perfectly reasonable.
 */
const acceptChoice = (
  options: Row[],
  variableName: string,
  labelVariable: string | undefined,
  reply: { text: string; replyId: string | null },
): ReplyOutcome => {
  const chosen = (option: Row, label: string): ReplyOutcome => ({
    ok: true,
    value: option.id,
    ...(labelVariable ? { extraVariables: { [labelVariable]: label } } : {}),
  });

  // A tap gives us the exact id. Trust it, but only if we offered it — a
  // customer can replay an old list from earlier in the thread.
  if (reply.replyId) {
    const tapped = options.find((o) => o.id === reply.replyId);
    if (tapped) return chosen(tapped, reply.text.trim() || tapped.title);
  }

  const typed = reply.text.trim().toLowerCase();
  if (!typed) return { ok: false, reason: 'That is not one of the options offered' };

  // Exact title, then exact id (a tap whose id arrived as text), then a
  // unique prefix — "chicken" for "Chicken Biryani". Ambiguous prefixes are
  // rejected rather than guessed: picking the wrong dish is worse than asking.
  const byTitle = options.find((o) => o.title.trim().toLowerCase() === typed);
  if (byTitle) return chosen(byTitle, byTitle.title);

  const byId = options.find((o) => o.id.toLowerCase() === typed);
  if (byId) return chosen(byId, byId.title);

  const partial = options.filter((o) => o.title.trim().toLowerCase().startsWith(typed));
  if (partial.length === 1) return chosen(partial[0]!, partial[0]!.title);

  return {
    ok: false,
    reason: partial.length > 1
      ? `More than one option starts with "${reply.text.trim()}"`
      : 'That is not one of the options offered',
  };
};

export const listMessageExecutor: WorkflowNodeExecutor<
  ListConfig,
  { rowCount: number; offeredIds: string[] }
> = {
  type: 'LIST_MESSAGE',
  validateConfig: (config) => NODE_CONFIG_SCHEMAS.LIST_MESSAGE.parse(config),

  execute: async ({ config, node, tenantId, contact, variables, services, dryRun, logger }) => {
    const rows = await rowsFor(config, tenantId, variables);

    if (!rows.length) {
      // An empty catalogue is a real business state, not a crash. Failing lets
      // the graph's error branch say something useful.
      throw new NodeConfigError(
        config.source === 'static' ? 'This list has no rows configured'
          : config.source === 'variable'
            ? `No rows to show — {{vars.${config.itemsVariable ?? '?'}}} is empty`
            : 'Nothing available to show right now',
      );
    }

    if (!dryRun) {
      await services.whatsapp.sendList({
        to: contact.waId,
        body: config.body,
        button: config.buttonLabel,
        sections: [{ ...(config.header ? { title: clip(config.header, 24) } : {}), rows }],
      });
    }

    logger.debug('Sent list', { source: config.source, rows: rows.length });

    return {
      status: 'WAITING_FOR_USER',
      // The ids offered are recorded on the execution, so the reply can be
      // checked against exactly what this send contained rather than against a
      // catalogue that may have changed since.
      output: { rowCount: rows.length, offeredIds: rows.map((r) => r.id) },
      awaiting: { nodeId: node.id, variableName: config.variableName },
    };
  },

  acceptReply: async ({ config, reply, variables }) => {
    // Re-derive the options rather than trusting the reply blindly. The
    // catalogue can change between send and reply; an id that no longer exists
    // should be rejected, not written into an order.
    const tenantId = String(variables.__tenantId ?? '');
    const rows = tenantId ? await rowsFor(config, tenantId, variables) : [];
    const options = rows.length ? rows : config.rows;
    return acceptChoice(options, config.variableName, config.labelVariable, reply);
  },

  retryPrompt: (config) => config.retryMessage ?? config.body,
};

export const buttonMessageExecutor: WorkflowNodeExecutor<ButtonConfig, { offeredIds: string[] }> = {
  type: 'BUTTON_MESSAGE',
  validateConfig: (config) => NODE_CONFIG_SCHEMAS.BUTTON_MESSAGE.parse(config),

  execute: async ({ config, node, contact, services, dryRun }) => {
    if (!dryRun) {
      await services.whatsapp.sendButtons({
        to: contact.waId,
        body: config.body,
        buttons: config.buttons.map((b) => ({ id: b.id, title: clip(b.title, 20) })),
      });
    }

    return {
      status: 'WAITING_FOR_USER',
      output: { offeredIds: config.buttons.map((b) => b.id) },
      awaiting: { nodeId: node.id, variableName: config.variableName },
    };
  },

  acceptReply: ({ config, reply }) => {
    const outcome = acceptChoice(
      config.buttons,
      config.variableName,
      config.labelVariable,
      reply,
    );
    // Buttons are few and named, so a rejection can afford to list them.
    return outcome.ok
      ? outcome
      : { ok: false, reason: `Please choose one of: ${config.buttons.map((b) => b.title).join(', ')}` };
  },

  retryPrompt: (config) => config.retryMessage ?? config.body,
};
