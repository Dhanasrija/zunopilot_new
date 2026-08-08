import { prisma } from '../src/config/prisma.js';
import { logger } from '../src/config/logger.js';

/*
 * Starting copy for each kind of business.
 *
 * ── A seed, not a migration ─────────────────────────────────────────────────
 *
 * A migration must keep producing the same result forever, which is the wrong contract for
 * editable copy: an operator improving the restaurant persona in the console would have their
 * change overwritten by nothing, but the *next* person reading the migration would believe the
 * text in it is what production says. This is content, so it lives where content lives.
 *
 * ── Only where the column is still null ─────────────────────────────────────
 *
 * `upsert`-if-null rather than a plain write. Running this again after an operator has edited a
 * category in the console must not silently undo them — and re-running is exactly what happens on
 * a fresh deploy of a box that already has data.
 *
 * ── Why these two fields and not five ──────────────────────────────────────
 *
 * Persona and declined topics are the two that are genuinely category-shaped. The deflection
 * wordings and the length cap have house defaults in `assistant-copy.ts` that read the same for
 * everybody, and a per-category dimension nobody would fill differently is a column that only ever
 * goes stale.
 */

interface CategoryDefaults {
  persona: string;
  /** One per line. Added to the house floor, never instead of it. */
  outOfScope: string;
}

const DEFAULTS: Record<string, CategoryDefaults> = {
  RESTAURANT: {
    persona: 'Warm and quick. Short sentences, no sales language, and never more than one question '
      + 'at a time. If someone sounds like they want to order, get them to the menu rather than '
      + 'describing it.',
    outOfScope: 'nutrition, allergies or dietary advice\n'
      + 'table availability or reservations you have not been given\n'
      + 'complaints about a specific dish — those belong with a person',
  },
  ECOMMERCE_GROCERY: {
    persona: 'Practical and brief. Answer the question asked, and say plainly when something needs '
      + 'checking rather than guessing at stock or timings.',
    outOfScope: 'nutrition or dietary advice\n'
      + 'whether an item is in stock right now\n'
      + 'substitutions — offer to pass it to the team instead',
  },
  IT_SERVICES: {
    persona: 'Plain and specific, the way a senior engineer would answer: no marketing language, no '
      + 'adjectives doing the work of facts. If a question needs a number you have not been given, '
      + 'say so rather than approximating.',
    outOfScope: 'recruitment, internships and job enquiries\n'
      + 'free technical support for products this business did not build\n'
      + 'code review, debugging or architecture advice for someone else\'s system\n'
      + 'estimates, timelines or effort in days',
  },
};

const main = async () => {
  const categories = await prisma.businessCategory.findMany({
    select: {
      id: true, key: true, label: true, defaultPersona: true, defaultOutOfScopeTopics: true,
    },
  });

  let written = 0;
  let kept = 0;
  let unknown = 0;

  for (const category of categories) {
    const defaults = DEFAULTS[category.key];
    if (!defaults) {
      /*
       * A category an operator added in the console. Left alone on purpose: unset means the
       * assistant uses the house persona, which is bland but never wrong — the same reason
       * `catalogueNoun` is nullable rather than defaulted to a restaurant's word.
       */
      unknown += 1;
      logger.info('No starting copy for this category; it will use the house defaults', {
        key: category.key,
      });
      continue;
    }

    // Each column decided on its own: an operator may have written a persona and not a topic list.
    const data: { defaultPersona?: string; defaultOutOfScopeTopics?: string } = {};
    if (category.defaultPersona === null) data.defaultPersona = defaults.persona;
    if (category.defaultOutOfScopeTopics === null) data.defaultOutOfScopeTopics = defaults.outOfScope;

    if (Object.keys(data).length === 0) {
      kept += 1;
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    await prisma.businessCategory.update({ where: { id: category.id }, data });
    written += 1;
    logger.info('Seeded assistant copy for a category', {
      key: category.key, fields: Object.keys(data),
    });
  }

  logger.info('Assistant category defaults seeded', {
    written, alreadySet: kept, noStartingCopy: unknown, categories: categories.length,
  });
  await prisma.$disconnect();
};

main().catch(async (err) => {
  logger.error('Seeding assistant category defaults failed', {
    error: err instanceof Error ? err.message : String(err),
  });
  await prisma.$disconnect();
  process.exit(1);
});
