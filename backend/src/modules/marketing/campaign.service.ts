import type { Campaign, Prisma, TemplateHeaderFormat } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { ApiError } from '../../utils/ApiError.js';
import { whatsappProviderFor } from '../conversation-engine/providers/whatsapp.js';
import { publicUrlFor } from '../media/media.service.js';
import { recordOutboundMessage } from '../conversation-engine/providers/mirror.js';
import { mayReceiveMarketing } from './consent.service.js';

// Campaigns.
//
// The whole module is arranged around one asymmetry: a campaign that fails to
// send is an inconvenience, and a campaign that messages somebody who asked it
// not to is how a WhatsApp number gets reported, quality-rated down, and
// eventually suspended — taking every other feature down with it.
//
// So the defaults here all lean the same way. Consent is re-checked at the last
// possible moment. A recipient can only be written once. An error stops the
// campaign rather than retrying into the same wall.

export const campaignInclude = {
  template: {
    select: {
      id: true, name: true, metaTemplate: true, language: true, category: true,
      status: true, bodyPreview: true, headerFormat: true,
    },
  },
  createdBy: { select: { id: true, fullName: true } },
  // Loaded here rather than fetched at send time: `sendCampaignBatch` needs the asset for
  // every message in the batch, and the include is the difference between one join and one
  // query per recipient.
  headerMedia: true,
} satisfies Prisma.CampaignInclude;

/**
 * The header formats that require a file.
 *
 * `TEXT` and `NONE` are headers too, and neither needs media — treating "has a header" as
 * "needs media" would block every text-header template for no reason.
 */
const MEDIA_HEADERS: TemplateHeaderFormat[] = ['IMAGE', 'VIDEO', 'DOCUMENT'];

export interface AudienceFilter {
  /** Only customers seen since this date. */
  lastSeenAfter?: string | null;
  /** Only customers who have placed at least one order. */
  hasOrdered?: boolean;
  /**
   * Only customers on at least one of these curated lists.
   *
   * Membership is static, which is what makes a list safe to name here: `startCampaign`
   * freezes recipients once, and a list does not change on its own, so the group somebody
   * reviewed is the group that receives.
   */
  listIds?: string[] | null;
}

/**
 * The clauses shared by the reachable and the excluded counts.
 *
 * Factored out because the two used to be written twice, and a filter added to one and
 * not the other makes `excludedNoConsent` describe a different population than the number
 * beside it — which is worse than no denominator at all.
 */
const audienceScope = (filter: AudienceFilter): Prisma.CustomerWhereInput => ({
  ...(filter.lastSeenAfter ? { lastSeenAt: { gte: new Date(filter.lastSeenAfter) } } : {}),
  ...(filter.hasOrdered ? { orders: { some: {} } } : {}),
  ...(filter.listIds?.length
    ? { listMemberships: { some: { listId: { in: filter.listIds } } } }
    : {}),
});

/**
 * Who a filter currently matches.
 *
 * **Consent is not a filter option** — it is applied unconditionally, so there
 * is no combination of inputs a caller can supply that reaches somebody who has
 * opted out. Making it a parameter would eventually make it a checkbox.
 */
export const audienceWhere = (tenantId: string, filter: AudienceFilter): Prisma.CustomerWhereInput => ({
  tenantId,
  // Outside `audienceScope` on purpose. Consent is not one of the filters — no
  // combination of inputs, a curated list included, reaches somebody who opted out.
  // Putting a person on a list is a statement about your marketing, not about their
  // consent.
  marketingOptIn: true,
  optedOutAt: null,
  ...audienceScope(filter),
});

export interface AudiencePreview {
  reachable: number;
  /** Excluded because they never opted in or have since opted out. */
  excludedNoConsent: number;
}

/**
 * How many people a campaign would reach, and how many it would not.
 *
 * The excluded count is shown deliberately. A business that sees "412 reachable"
 * with no denominator has no idea it is talking to a third of its customers, and
 * that is exactly when someone starts looking for a way to message the rest.
 */
export const previewAudience = async (
  tenantId: string,
  filter: AudienceFilter,
): Promise<AudiencePreview> => {
  const consentless: Prisma.CustomerWhereInput = {
    tenantId,
    OR: [{ marketingOptIn: false }, { optedOutAt: { not: null } }],
    // The same scope as the reachable count, so "412 reachable, 88 excluded" describes
    // 500 people who match the filter rather than two unrelated numbers.
    ...audienceScope(filter),
  };

  const [reachable, excludedNoConsent] = await Promise.all([
    prisma.customer.count({ where: audienceWhere(tenantId, filter) }),
    prisma.customer.count({ where: consentless }),
  ]);

  return { reachable, excludedNoConsent };
};

export const campaignOf = async (tenantId: string, campaignId: string) => {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, tenantId },
    include: campaignInclude,
  });
  if (!campaign) throw ApiError.notFound('Campaign not found');
  return campaign;
};

/** Live counts per recipient state, for the progress view. */
export const campaignProgress = async (campaignId: string) => {
  const rows = await prisma.campaignRecipient.groupBy({
    by: ['status'],
    where: { campaignId },
    _count: { _all: true },
  });
  const counts = Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
  const total = rows.reduce((sum, row) => sum + row._count._all, 0);
  return { total, counts };
};

/**
 * Freeze the audience and hand the campaign to the send worker.
 *
 * Recipients are materialised **once**, here, rather than being queried as the
 * send walks. A live query would let the audience shift underneath a running
 * campaign — somebody added mid-send gets a message from a campaign that was
 * approved before they existed, and the totals on the screen never settle.
 *
 * `createMany` with `skipDuplicates` against the `(campaignId, customerId)`
 * unique index makes starting twice a no-op rather than a double-send.
 */
export const startCampaign = async (
  tenantId: string,
  campaignId: string,
): Promise<Campaign> => {
  const campaign = await campaignOf(tenantId, campaignId);

  if (!['DRAFT', 'SCHEDULED', 'PAUSED'].includes(campaign.status)) {
    throw ApiError.badRequest(`This campaign is ${campaign.status.toLowerCase()} and cannot be started.`);
  }
  if (campaign.template.status !== 'APPROVED') {
    // Meta rejects an unapproved template per message. Failing here means one
    // error on a screen instead of several hundred in a log.
    throw ApiError.badRequest(
      `The template "${campaign.template.name}" is ${campaign.template.status.toLowerCase()}. `
      + 'Meta only delivers approved templates.',
    );
  }

  /*
   * A media header with no media is refused **here**, not at Meta.
   *
   * Without this the campaign starts, and then every single message fails with a component
   * mismatch — four hundred recipients, four hundred identical Graph API errors, and the
   * only explanation in a log. One error on one screen is the same information delivered
   * somewhere a person can act on it.
   */
  const needsMedia = MEDIA_HEADERS.includes(campaign.template.headerFormat);
  if (needsMedia && !campaign.headerMediaId) {
    throw ApiError.badRequest(
      `The template "${campaign.template.name}" has a `
      + `${campaign.template.headerFormat.toLowerCase()} header, so it needs a `
      + `${campaign.template.headerFormat.toLowerCase()} attached before it can send.`,
    );
  }
  if (needsMedia && campaign.headerMedia
      && campaign.headerMedia.kind !== campaign.template.headerFormat) {
    // Attaching a video to an image header is accepted by neither Meta nor common sense.
    throw ApiError.badRequest(
      `That template needs a ${campaign.template.headerFormat.toLowerCase()}, but the `
      + `attached file is a ${campaign.headerMedia.kind.toLowerCase()}.`,
    );
  }

  const channel = await prisma.whatsappAccount.findFirst({ where: { tenantId } });
  if (!channel) throw ApiError.badRequest('No WhatsApp number is connected.');

  const filter = (campaign.audienceFilter ?? {}) as AudienceFilter;
  const audience = await prisma.customer.findMany({
    where: audienceWhere(tenantId, filter),
    select: { id: true },
  });

  if (audience.length === 0) {
    throw ApiError.badRequest(
      'Nobody matches this audience. Only customers who have messaged you and not '
      + 'opted out can be sent marketing.',
    );
  }

  await prisma.campaignRecipient.createMany({
    data: audience.map((customer) => ({ campaignId, customerId: customer.id })),
    skipDuplicates: true,
  });

  const updated = await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: 'SENDING', startedAt: campaign.startedAt ?? new Date(), error: null },
  });

  logger.info('Campaign started', { tenantId, campaignId, recipients: audience.length });
  return updated;
};

/** Stop a running campaign. Pending recipients are simply never sent. */
export const pauseCampaign = async (tenantId: string, campaignId: string): Promise<Campaign> => {
  const campaign = await campaignOf(tenantId, campaignId);
  if (campaign.status !== 'SENDING') {
    throw ApiError.badRequest('Only a sending campaign can be paused.');
  }
  return prisma.campaign.update({ where: { id: campaignId }, data: { status: 'PAUSED' } });
};

export interface SendOutcome {
  sent: number;
  skipped: number;
  failed: number;
  remaining: number;
}

/**
 * Send the next slice of a campaign.
 *
 * Called repeatedly by a scheduled worker rather than looping to completion, so
 * a campaign of ten thousand cannot hold a worker — or Meta's per-number
 * throughput — against the inbound queue that customer messages arrive on.
 * Answering the people already talking to the business matters more than
 * finishing a promotion a minute sooner.
 */
export const sendCampaignBatch = async (
  campaignId: string,
  batchSize: number,
): Promise<SendOutcome> => {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: campaignInclude,
  });
  if (!campaign || campaign.status !== 'SENDING') {
    return { sent: 0, skipped: 0, failed: 0, remaining: 0 };
  }

  const channel = await prisma.whatsappAccount.findFirst({ where: { tenantId: campaign.tenantId } });
  if (!channel) {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'FAILED', error: 'No WhatsApp number is connected.', completedAt: new Date() },
    });
    return { sent: 0, skipped: 0, failed: 0, remaining: 0 };
  }

  const pending = await prisma.campaignRecipient.findMany({
    where: { campaignId, status: 'PENDING' },
    include: { customer: true },
    take: batchSize,
  });

  const provider = whatsappProviderFor(channel);
  const params = Object.values((campaign.variableValues ?? {}) as Record<string, string>);

  /*
   * The header media, resolved once for the whole batch rather than per recipient.
   *
   * The URL is the same for every message, and `publicUrlFor` is pure — but building it in
   * the loop would invite a database read per recipient the day it stops being pure.
   */
  const headerMedia = campaign.headerMedia && MEDIA_HEADERS.includes(campaign.template.headerFormat)
    ? {
      kind: campaign.headerMedia.kind,
      link: publicUrlFor(campaign.headerMedia),
      filename: campaign.headerMedia.originalName,
    }
    : undefined;
  const outcome: SendOutcome = { sent: 0, skipped: 0, failed: 0, remaining: 0 };

  for (const recipient of pending) {
    // **Consent, re-checked here and not only when the audience was built.**
    //
    // This is the line that matters most in the module. Between building the
    // audience and reaching this row, minutes or hours may have passed and the
    // customer may have replied STOP — which is exactly when someone is most
    // likely to, because a campaign just landed. Trusting the frozen list would
    // send to somebody who has already refused.
    if (!mayReceiveMarketing(recipient.customer)) {
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: { status: 'SKIPPED_OPTED_OUT' },
      });
      outcome.skipped += 1;
      continue;
    }

    try {
      const sent = await provider.sendTemplate({
        to: recipient.customer.waId,
        templateName: campaign.template.metaTemplate,
        language: campaign.template.language,
        params,
        headerMedia,
      });

      // A campaign send is a message like any other: it belongs in the thread,
      // so a reply lands in the Inbox against the conversation it answers rather
      // than opening an orphan.
      const conversation = await conversationFor(campaign.tenantId, recipient.customerId);
      const mirrored = await recordOutboundMessage(
        {
          tenantId: campaign.tenantId,
          conversationId: conversation.id,
          customerId: recipient.customerId,
        },
        { type: 'TEXT', body: campaign.template.bodyPreview, messageId: sent.messageId },
      );

      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          messageId: mirrored.id,
          waMessageId: sent.messageId,
        },
      });
      outcome.sent += 1;
    } catch (err) {
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: {
          status: 'FAILED',
          failedAt: new Date(),
          error: err instanceof Error ? err.message.slice(0, 500) : 'Send failed',
        },
      });
      outcome.failed += 1;
    }
  }

  outcome.remaining = await prisma.campaignRecipient.count({ where: { campaignId, status: 'PENDING' } });

  if (outcome.remaining === 0) {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'SENT', completedAt: new Date() },
    });
    logger.info('Campaign finished', { campaignId, ...outcome });
  }

  return outcome;
};

/** The open conversation for this customer, or a new one to hang the send on. */
const conversationFor = async (tenantId: string, customerId: string) => {
  const existing = await prisma.conversation.findFirst({
    where: { tenantId, customerId, status: { in: ['OPEN', 'HUMAN_TAKEOVER'] } },
    orderBy: { lastMessageAt: 'desc' },
  });
  if (existing) return existing;

  return prisma.conversation.create({
    data: { tenantId, customerId, status: 'OPEN', lastMessageAt: new Date(), unreadCount: 0 },
  });
};

/**
 * Every campaign that still has people to send to.
 *
 * Driven by the sweep rather than by a job per recipient: a campaign of ten
 * thousand would otherwise enqueue ten thousand rows the moment it starts, and
 * pausing it would mean cancelling all of them.
 */
export const sendingCampaignIds = async (): Promise<string[]> => {
  const rows = await prisma.campaign.findMany({
    where: { status: 'SENDING' },
    select: { id: true },
    take: 50,
  });
  return rows.map((row) => row.id);
};
