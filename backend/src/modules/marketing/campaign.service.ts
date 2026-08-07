import type { Campaign, CampaignStatus, Prisma, TemplateHeaderFormat } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { ApiError } from '../../utils/ApiError.js';
import { whatsappProviderFor } from '../conversation-engine/providers/whatsapp.js';
import { publicUrlFor } from '../media/media.service.js';
import { recordOutboundMessage } from '../conversation-engine/providers/mirror.js';
import { mayReceiveMarketing } from './consent.service.js';
import { metaFailure, metaFailureMessage } from '../../services/meta-error.js';
import {
  missingVariables, renderBody, resolveVariables, type ResolvableCustomer,
} from './campaign-variables.js';

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
      // Needed at send time to know which placeholders to fill, and in what order.
      variables: true,
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

  /*
   * A placeholder with nothing behind it is refused **here**, for the same reason as the
   * media header above — and this one has already happened.
   *
   * A campaign went out against a template opening `Hi {{1}},` with `variableValues: {}`.
   * Meta rejected every single recipient with 132000, "number of localizable_params (0) does
   * not match the expected number of params (1)". Two recipients, so two rejections; the
   * same campaign with a real audience would have made four hundred identical Graph calls,
   * every one of them doomed before the first was sent, and reported success at the end.
   */
  const unfilled = missingVariables(campaign.template.variables, campaign.variableValues);
  if (unfilled.length > 0) {
    throw ApiError.badRequest(
      `The template "${campaign.template.name}" has `
      + `${unfilled.length === 1 ? 'a placeholder' : `${unfilled.length} placeholders`} `
      + `with no value: ${unfilled.map((v) => `{{${v}}}`).join(', ')}. `
      + 'WhatsApp rejects a message whose placeholders are not all filled.',
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

/**
 * The states a campaign can still be changed in.
 *
 * Everything else has reached somebody. `SENDING` is obvious; `SENT`, `FAILED` and `CANCELLED`
 * are records of what happened, and a record you can rewrite is not one. `PAUSED` is excluded
 * for the same reason — some of its audience already has the message, so editing the text now
 * would leave two different messages under one name.
 */
const EDITABLE: CampaignStatus[] = ['DRAFT', 'SCHEDULED'];

const refuseUnlessEditable = (campaign: { status: CampaignStatus; name: string }, verb: string) => {
  if (EDITABLE.includes(campaign.status)) return;
  throw ApiError.badRequest(
    `"${campaign.name}" is ${campaign.status.toLowerCase()}, so it cannot be ${verb}. `
    + 'A campaign that has started is a record of what was sent.',
  );
};

export interface CampaignEdit {
  name?: string;
  templateId?: string;
  audienceFilter?: AudienceFilter;
  variableValues?: unknown;
  headerMediaId?: string | null;
  scheduledAt?: Date | null;
}

/**
 * Change a draft.
 *
 * **Why this exists.** `startCampaign` now refuses a template whose placeholders are unfilled,
 * which is right — but with no way to edit a campaign, a draft created before that guard, or by
 * a browser still running an older page, could never be given its values and could never be
 * removed either. It just sat there refusing to start. Turning "sends badly" into "sits there
 * forever" is not an improvement, and this is the other half of that change.
 */
export const editCampaign = async (
  tenantId: string,
  campaignId: string,
  edit: CampaignEdit,
): Promise<Campaign> => {
  const campaign = await campaignOf(tenantId, campaignId);
  refuseUnlessEditable(campaign, 'edited');

  // A template id from the client is resolved against this workspace before it is stored, the
  // same as on create — otherwise a campaign could be pointed at another tenant's template.
  if (edit.templateId && edit.templateId !== campaign.templateId) {
    const template = await prisma.campaignTemplate.findFirst({
      where: { id: edit.templateId, tenantId },
      select: { id: true },
    });
    if (!template) throw ApiError.badRequest('That template is not in this workspace');
  }

  return prisma.campaign.update({
    where: { id: campaignId },
    data: {
      ...(edit.name !== undefined ? { name: edit.name } : {}),
      ...(edit.templateId !== undefined ? { templateId: edit.templateId } : {}),
      ...(edit.audienceFilter !== undefined
        ? { audienceFilter: edit.audienceFilter as Prisma.InputJsonValue } : {}),
      ...(edit.variableValues !== undefined
        ? { variableValues: edit.variableValues as Prisma.InputJsonValue } : {}),
      ...(edit.headerMediaId !== undefined ? { headerMediaId: edit.headerMediaId } : {}),
      ...(edit.scheduledAt !== undefined
        ? { scheduledAt: edit.scheduledAt, status: edit.scheduledAt ? 'SCHEDULED' : 'DRAFT' }
        : {}),
    },
  });
};

/**
 * Throw a draft away.
 *
 * Only ever a draft: a campaign that has sent anything is the only record of who received it,
 * and `CampaignRecipient` cascades, so deleting one would erase the delivery history along with
 * it. The refusal says which state it is in rather than just "no".
 */
export const deleteCampaign = async (tenantId: string, campaignId: string): Promise<void> => {
  const campaign = await campaignOf(tenantId, campaignId);
  refuseUnlessEditable(campaign, 'deleted');

  await prisma.campaign.delete({ where: { id: campaignId } });
  logger.info('Campaign deleted', { tenantId, campaignId, name: campaign.name });
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

    /*
     * Resolved per recipient, not once for the batch.
     *
     * `{{1}}` in a marketing template is almost always the customer's name, so the values
     * cannot be hoisted out of the loop — which is what the old code did, taking
     * `Object.values(variableValues)` before the first send.
     */
    const params = resolveVariables(
      campaign.template.variables,
      campaign.variableValues,
      recipient.customer as ResolvableCustomer,
    );

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
        // The rendered body, not the raw template. Mirroring `bodyPreview` put a literal
        // "Hi {{1}}," in the Inbox thread, so the agent who picked up the reply saw
        // something the customer never received.
        {
          type: 'TEXT',
          body: renderBody(campaign.template.bodyPreview, params),
          messageId: sent.messageId,
        },
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
          // Meta's own sentence. This column used to hold "Request failed with status code
          // 400" for every failure, which is true of a rejected template, an expired token
          // and a rate limit alike — so the one screen that exists to explain a failed
          // campaign explained nothing.
          error: metaFailureMessage(err).slice(0, 500),
        },
      });
      outcome.failed += 1;
    }
  }

  outcome.remaining = await prisma.campaignRecipient.count({ where: { campaignId, status: 'PENDING' } });

  if (outcome.remaining === 0) {
    /*
     * The terminal status describes the whole campaign, not this batch.
     *
     * `outcome` counts one slice; a campaign of four hundred settles over many, so asking
     * the recipients is the only way to know whether anything actually went out.
     *
     * **A campaign where nothing sent is FAILED.** It used to be marked SENT
     * unconditionally the moment the queue drained — the production campaign that failed
     * every recipient on a missing placeholder was recorded as `status SENT, error null`,
     * so the list said it worked and the only contradiction was a count on another screen.
     * Reporting a total failure as a success is worse than the failure.
     */
    const [totals, firstFailure] = await Promise.all([
      prisma.campaignRecipient.groupBy({
        by: ['status'],
        where: { campaignId },
        _count: { _all: true },
      }),
      prisma.campaignRecipient.findFirst({
        where: { campaignId, status: 'FAILED', error: { not: null } },
        select: { error: true },
      }),
    ]);
    const count = (status: string) =>
      totals.find((row) => row.status === status)?._count._all ?? 0;

    const sent = count('SENT');
    const failed = count('FAILED');
    const nothingSent = sent === 0 && failed > 0;

    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        status: nothingSent ? 'FAILED' : 'SENT',
        completedAt: new Date(),
        // Carried up from the recipients so the reason is on the campaign itself. The
        // failures are all the same one often enough — a template Meta will not accept,
        // an expired token — that the first is a fair summary, and the per-recipient rows
        // are still there for the cases where it is not.
        ...(nothingSent
          ? { error: firstFailure?.error ?? 'Every message was refused by WhatsApp.' }
          : {}),
      },
    });
    // Campaign totals alongside this batch's, so a log line for the last slice of a long
    // send does not read as though the whole campaign delivered two messages.
    logger.info('Campaign finished', {
      campaignId, totalSent: sent, totalFailed: failed, ...outcome,
    });
  }

  return outcome;
};

export interface TestSend {
  templateId: string;
  to: string;
  variableValues: unknown;
  headerMediaId?: string | null;
}

/**
 * Send one message to a number the operator names, before any campaign exists.
 *
 * The gap this closes: everything about a broadcast is checkable on screen except the one
 * thing that matters, which is whether Meta accepts the message. A wrong placeholder count,
 * a template whose approved body drifted from our preview, a header that needs media — all
 * of it is invisible until the send, and by then it has happened to everybody.
 *
 * Deliberately **not** a campaign: no `Campaign` row, no `CampaignRecipient`, and no mirror
 * into the Inbox. A test is the operator talking to their own phone, and turning that into a
 * conversation would put a message in the CRM that no customer ever asked for. The composer
 * says so on screen.
 */
export const sendTestMessage = async (
  tenantId: string,
  input: TestSend,
): Promise<{ to: string; body: string; messageId: string | null }> => {
  const template = await prisma.campaignTemplate.findFirst({
    where: { id: input.templateId, tenantId },
  });
  if (!template) throw ApiError.badRequest('That template is not in this workspace');
  if (template.status !== 'APPROVED') {
    throw ApiError.badRequest(
      `The template "${template.name}" is ${template.status.toLowerCase()}. `
      + 'Meta only delivers approved templates.',
    );
  }

  const unfilled = missingVariables(template.variables, input.variableValues);
  if (unfilled.length > 0) {
    throw ApiError.badRequest(
      `Fill every placeholder before testing: ${unfilled.map((v) => `{{${v}}}`).join(', ')}.`,
    );
  }

  const needsMediaHeader = MEDIA_HEADERS.includes(template.headerFormat);
  if (needsMediaHeader && !input.headerMediaId) {
    throw ApiError.badRequest(
      `That template has a ${template.headerFormat.toLowerCase()} header, so it needs a `
      + `${template.headerFormat.toLowerCase()} attached before it can be tested.`,
    );
  }

  const channel = await prisma.whatsappAccount.findFirst({ where: { tenantId } });
  if (!channel) throw ApiError.badRequest('No WhatsApp number is connected.');

  /*
   * If the test number belongs to a customer, their consent applies.
   *
   * Calling it a test does not make it a different message: the person receives a marketing
   * template on WhatsApp either way. Without this, "send a test" would be the one path in
   * the module that reaches somebody who replied STOP — and the whole module is arranged
   * around that never happening.
   */
  const customer = await prisma.customer.findFirst({
    where: { tenantId, waId: input.to },
  });
  if (customer && !mayReceiveMarketing(customer)) {
    throw ApiError.badRequest(
      'That number belongs to a customer who has not opted in to marketing, or who replied '
      + 'STOP. Test with a number of your own instead.',
    );
  }

  // A matching customer also makes the test truthful: `{{1}}` bound to the customer name
  // renders theirs rather than the fallback, which is the version worth checking.
  const params = resolveVariables(template.variables, input.variableValues, customer);

  const headerMedia = input.headerMediaId && needsMediaHeader
    ? await (async () => {
      const asset = await prisma.mediaAsset.findFirst({
        where: { id: input.headerMediaId!, tenantId },
      });
      if (!asset) throw ApiError.badRequest('That attachment is not in this workspace');
      return { kind: asset.kind, link: publicUrlFor(asset), filename: asset.originalName };
    })()
    : undefined;

  try {
    const sent = await whatsappProviderFor(channel).sendTemplate({
      to: input.to,
      templateName: template.metaTemplate,
      language: template.language,
      params,
      headerMedia,
    });
    logger.info('Campaign test message sent', { tenantId, templateId: template.id });
    return {
      to: input.to,
      body: renderBody(template.bodyPreview, params),
      messageId: sent.messageId,
    };
  } catch (err) {
    // The entire point of a test is to read Meta's objection, so it is surfaced rather than
    // swallowed into a 500.
    throw metaFailure(err) ?? err;
  }
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
