import type {
  CampaignTemplateCategory, CampaignTemplateStatus, Prisma, TemplateHeaderFormat,
} from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { fetchMetaTemplates, type MetaTemplate } from '../../services/whatsapp.service.js';
import { isSimulatedChannel } from '../conversation-engine/providers/whatsapp.js';
import { logger } from '../../config/logger.js';

// Reconciling campaign templates with Meta.
//
// **Why sync rather than let an operator type it in.** A template's header format decides
// what every send must carry: an IMAGE header without an image is refused by the Graph API
// per recipient, so a campaign to four hundred people fails four hundred times and says why
// only in a log. The approved template is the only authority on that, and this reads it.
//
// Everything derived here — header format, body, variables, category, status — comes off the
// template Meta actually holds, so the media prompt on the campaign page cannot disagree
// with what the send will need.

/** One HEADER / BODY / FOOTER / BUTTONS entry as Meta returns it. */
interface MetaComponent {
  type?: string;
  format?: string;
  text?: string;
  buttons?: Array<{ type?: string; text?: string }>;
}

/** What a preview shows of one button. See the `buttons` note on the model. */
export interface TemplateButton {
  type: string;
  text: string;
}

const HEADER_FORMATS: TemplateHeaderFormat[] = ['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'];

/**
 * The header format, or NONE.
 *
 * `LOCATION` headers exist and are deliberately not in our enum — nothing here can supply a
 * lat/long, so such a template maps to NONE and simply cannot be picked for a campaign,
 * which is better than offering a media slot it will not accept.
 */
export const headerFormatOf = (components: MetaComponent[]): TemplateHeaderFormat => {
  const header = components.find((c) => c.type?.toUpperCase() === 'HEADER');
  if (!header) return 'NONE';
  const format = header.format?.toUpperCase() as TemplateHeaderFormat | undefined;
  return format && HEADER_FORMATS.includes(format) ? format : 'NONE';
};

export const bodyOf = (components: MetaComponent[]): string =>
  components.find((c) => c.type?.toUpperCase() === 'BODY')?.text ?? '';

/**
 * The header's own text, and only for a TEXT header.
 *
 * A media header carries no text, so returning Meta's `text` for one — it is sometimes
 * present and holds the sample's filename — would put a filename at the top of the preview
 * as if the customer would see it.
 */
export const headerTextOf = (components: MetaComponent[]): string | null => {
  const header = components.find((c) => c.type?.toUpperCase() === 'HEADER');
  if (header?.format?.toUpperCase() !== 'TEXT') return null;
  return header.text?.trim() || null;
};

export const footerTextOf = (components: MetaComponent[]): string | null =>
  components.find((c) => c.type?.toUpperCase() === 'FOOTER')?.text?.trim() || null;

/**
 * The buttons, label and kind only.
 *
 * Unknown button types are kept rather than dropped: a template really does have that button
 * and the customer really will see it, so showing the label under a neutral kind is more
 * honest than a preview that is quietly missing a row. The preview decides what icon, if
 * any, a kind gets.
 */
export const buttonsOf = (components: MetaComponent[]): TemplateButton[] => {
  const group = components.find((c) => c.type?.toUpperCase() === 'BUTTONS');
  return (group?.buttons ?? [])
    .map((b) => ({ type: (b.type ?? 'UNKNOWN').toUpperCase(), text: (b.text ?? '').trim() }))
    // A button with no label cannot be previewed and would render as an empty row.
    .filter((b) => b.text.length > 0)
    .slice(0, 10);
};

/**
 * The `{{1}}`, `{{2}}` placeholders in the body, in order and de-duplicated.
 *
 * Stored so the campaign page knows how many values to collect. Sorted numerically, not
 * lexically — `{{10}}` must not sort between `{{1}}` and `{{2}}`.
 */
export const variablesOf = (body: string): string[] => {
  const found = [...body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]));
  return [...new Set(found)].sort((a, b) => a - b).map(String);
};

/**
 * Meta's category to ours.
 *
 * `AUTHENTICATION` is a real Meta category with no equivalent here. It maps to UTILITY
 * because it is emphatically not marketing, and the campaign picker only offers MARKETING —
 * so an OTP template can never be sent as a broadcast.
 */
export const categoryOf = (category?: string): CampaignTemplateCategory =>
  (category?.toUpperCase() === 'MARKETING' ? 'MARKETING' : 'UTILITY');

/**
 * Meta's status to ours.
 *
 * **Anything unrecognised becomes PENDING, never APPROVED.** `startCampaign` refuses a
 * template that is not APPROVED, so guessing wrong in that direction blocks a send that
 * might have worked — while guessing wrong the other way lets a campaign start against a
 * template Meta will reject on every message. Failing closed is the cheaper mistake.
 */
export const statusOf = (status?: string): CampaignTemplateStatus => {
  switch (status?.toUpperCase()) {
    case 'APPROVED': return 'APPROVED';
    case 'REJECTED':
    case 'DISABLED':
    case 'PAUSED': return 'REJECTED';
    default: return 'PENDING';
  }
};

export interface SyncOutcome {
  created: number;
  updated: number;
  /** Templates Meta returned that were skipped, with why. */
  skipped: Array<{ name: string; reason: string }>;
}

export const syncTemplatesFromMeta = async (tenantId: string): Promise<SyncOutcome> => {
  const channel = await prisma.whatsappAccount.findFirst({ where: { tenantId } });
  if (!channel) throw ApiError.badRequest('No WhatsApp number is connected.');

  // A demo or mock channel has no real credentials, and calling Meta with them would fail
  // with something unhelpful. Say what is actually wrong instead.
  if (isSimulatedChannel(channel)) {
    throw ApiError.badRequest(
      'This workspace is on a simulated WhatsApp channel, so there are no Meta templates to '
      + 'sync. Connect a real number first.',
    );
  }

  let templates: MetaTemplate[];
  try {
    const response = await fetchMetaTemplates({
      accessToken: channel.accessToken,
      wabaId: channel.wabaId,
    });
    templates = response.data ?? [];
  } catch (error) {
    logger.error('Template sync failed', { tenantId, error: (error as Error).message });
    throw ApiError.unprocessable(
      'Could not reach Meta to read the templates. The channel token may have expired.',
    );
  }

  const outcome: SyncOutcome = { created: 0, updated: 0, skipped: [] };

  for (const template of templates) {
    if (!template.id || !template.name) {
      outcome.skipped.push({ name: template.name ?? '(unnamed)', reason: 'no id or name' });
      continue;
    }

    const components = (template.components ?? []) as MetaComponent[];
    const body = bodyOf(components);
    if (!body) {
      // Every template we can send has a body to preview. One without is either malformed
      // or a shape this does not model, and inventing a preview would be worse.
      outcome.skipped.push({ name: template.name, reason: 'no body component' });
      continue;
    }

    const data = {
      tenantId,
      name: template.name,
      metaTemplate: template.name,
      language: template.language ?? 'en',
      category: categoryOf(template.category),
      status: statusOf(template.status),
      headerFormat: headerFormatOf(components),
      headerText: headerTextOf(components),
      bodyPreview: body,
      footerText: footerTextOf(components),
      // Prisma's `InputJsonValue` will not take an array of interfaces — an interface has no
      // index signature, so `TemplateButton[]` is not structurally a JSON array to it. The
      // shape is asserted by `buttonsOf` and its tests; this cast only satisfies that gap.
      buttons: buttonsOf(components) as unknown as Prisma.InputJsonValue,
      variables: variablesOf(body),
      metaId: template.id,
      syncedAt: new Date(),
    };

    // Keyed on Meta's own id, so re-syncing updates in place. An existing hand-made row for
    // the same template name is adopted rather than duplicated — otherwise the picker would
    // show two entries for one template, one of them with a stale header format.
    const existing = await prisma.campaignTemplate.findFirst({
      where: {
        tenantId,
        OR: [{ metaId: template.id }, { metaTemplate: template.name, metaId: null }],
      },
      select: { id: true },
    });

    if (existing) {
      await prisma.campaignTemplate.update({ where: { id: existing.id }, data });
      outcome.updated += 1;
    } else {
      await prisma.campaignTemplate.create({ data });
      outcome.created += 1;
    }
  }

  logger.info('Templates synced from Meta', { tenantId, ...outcome, skipped: outcome.skipped.length });
  return outcome;
};
