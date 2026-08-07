import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../app.js';
import { prisma } from '../../config/prisma.js';
import { signToken } from '../../utils/jwt.js';
import { seedDefaultRoles } from '../../services/role.service.js';
import { MOCK_CHANNEL_TOKEN_PREFIX, mockProviderFor } from '../conversation-engine/providers/whatsapp.js';
import { sendCampaignBatch, startCampaign } from '../marketing/campaign.service.js';

// Template header media.
//
// The point of this file is the last block: **a template with an image header must actually
// send an image.** Everything before it protects the two ways that goes wrong — a file Meta
// would refuse, or a campaign that starts without one and then fails on every message.

const TENANT = '99999999-9999-9999-9999-99999999d001';
const OTHER = '99999999-9999-9999-9999-99999999d002';
const app = buildApp();

let token: string;
let otherToken: string;
let channelId: string;

/** A tiny valid-enough PNG. The bytes are never decoded; only the MIME type is read. */
const png = () => Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

const wipe = async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [TENANT, OTHER] } } });
};

const makeWorkspace = async (tenantId: string, phone: string) => {
  await prisma.tenant.create({
    data: { id: tenantId, businessName: `Media ${tenantId.slice(-4)}`, category: 'RESTAURANT' },
  });
  await prisma.tenantModule.create({
    data: { tenantId, module: 'MARKETING', enabled: true },
  });
  await seedDefaultRoles(prisma, tenantId);
  const ownerRole = await prisma.role.findFirst({
    where: { tenantId, isOwner: true }, select: { id: true },
  });
  const user = await prisma.user.create({
    data: { tenantId, phone, fullName: 'Owner', role: 'OWNER', roleId: ownerRole?.id },
  });
  const channel = await prisma.whatsappAccount.create({
    data: {
      tenantId,
      wabaId: `waba-${tenantId.slice(-4)}`,
      phoneNumberId: `chan-${tenantId.slice(-4)}`,
      // A simulated channel, so nothing in here can reach Meta.
      accessToken: `${MOCK_CHANNEL_TOKEN_PREFIX}${tenantId.slice(-4)}`,
    },
  });
  return { token: signToken({ userId: user.id, tenantId }), channelId: channel.id };
};

beforeEach(async () => {
  await wipe();
  const mine = await makeWorkspace(TENANT, '15557000001');
  token = mine.token;
  channelId = mine.channelId;
  otherToken = (await makeWorkspace(OTHER, '15557000002')).token;
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const uploadPng = (t = token, name = 'offer.png') => request(app)
  .post('/api/media').set(auth(t))
  .attach('file', png(), { filename: name, contentType: 'image/png' });

describe('uploading', () => {
  it('stores a PNG and reports the public URL Meta will fetch', async () => {
    const response = await uploadPng().expect(201);
    expect(response.body.data.kind).toBe('IMAGE');
    expect(response.body.data.originalName).toBe('offer.png');
    // The URL carries the id, not the storage key — the key never leaves the server.
    expect(response.body.data.url).toContain(`/media/${response.body.data.id}/`);
  });

  it('**derives the kind from the file, not from the caller**', async () => {
    // A caller claiming IMAGE for an MP4 would produce a send Meta refuses. The MIME type
    // is the only honest source, so there is no `kind` field to lie in.
    const response = await request(app).post('/api/media').set(auth(token))
      .attach('file', Buffer.from('not really a video'), {
        filename: 'clip.mp4', contentType: 'video/mp4',
      })
      .expect(201);
    expect(response.body.data.kind).toBe('VIDEO');
  });

  it('refuses a type WhatsApp will not accept in a header', async () => {
    const response = await request(app).post('/api/media').set(auth(token))
      .attach('file', Buffer.from('<svg/>'), { filename: 'logo.svg', contentType: 'image/svg+xml' })
      .expect(400);
    // Says what is accepted, rather than only what is not.
    expect(response.body.message).toMatch(/JPEG or PNG/);
  });

  it('refuses an image over Meta\'s 5 MB ceiling', async () => {
    const tooBig = Buffer.alloc(6 * 1024 * 1024, 1);
    const response = await request(app).post('/api/media').set(auth(token))
      .attach('file', tooBig, { filename: 'huge.png', contentType: 'image/png' })
      .expect(400);
    // The limit belongs to Meta; enforcing it at upload turns several hundred per-recipient
    // Graph errors into one message on a screen.
    expect(response.body.message).toMatch(/5 MB/);
  });

  it('refuses a request with no file', async () => {
    await request(app).post('/api/media').set(auth(token)).expect(400);
  });

  it('needs authentication', async () => {
    await request(app).post('/api/media').attach('file', png(), 'x.png').expect(401);
  });
});

describe('the library', () => {
  it('lists only this workspace\'s media', async () => {
    await uploadPng(token, 'mine.png').expect(201);
    await uploadPng(otherToken, 'theirs.png').expect(201);

    const response = await request(app).get('/api/media').set(auth(token)).expect(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].originalName).toBe('mine.png');
  });

  it('filters by kind, so an image header is not offered a video', async () => {
    await uploadPng().expect(201);
    const images = await request(app).get('/api/media?kind=IMAGE').set(auth(token)).expect(200);
    const videos = await request(app).get('/api/media?kind=VIDEO').set(auth(token)).expect(200);
    expect(images.body.data).toHaveLength(1);
    expect(videos.body.data).toHaveLength(0);
  });

  it('reports whether Meta could actually reach the media URL', async () => {
    // Under test `APP_URL` is localhost, which it could not. Saying so is the difference
    // between a puzzling failure and an obvious one.
    const response = await request(app).get('/api/media/rules').set(auth(token)).expect(200);
    expect(response.body.data.publicUrlReachable).toBe(false);
    expect(response.body.data.kinds.IMAGE.maxBytes).toBe(5 * 1024 * 1024);
  });
});

describe('serving', () => {
  it('serves the bytes **without authentication**, because Meta cannot present a token', async () => {
    const uploaded = await uploadPng().expect(201);
    const response = await request(app)
      .get(`/media/${uploaded.body.data.id}/offer.png`)
      .expect(200);

    expect(response.headers['content-type']).toContain('image/png');
    // Operator-supplied bytes returned to an anonymous caller must never be sniffed into
    // being HTML.
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.body.length).toBe(png().length);
  });

  it('404s an unknown id rather than revealing anything', async () => {
    await request(app).get('/media/99999999-9999-9999-9999-999999999999/x.png').expect(404);
  });

  it('ignores the filename in the path — only the id locates the file', async () => {
    const uploaded = await uploadPng().expect(201);
    await request(app).get(`/media/${uploaded.body.data.id}/anything-at-all.png`).expect(200);
  });
});

describe('attaching media to a campaign', () => {
  const templateWith = (headerFormat: 'NONE' | 'IMAGE' | 'DOCUMENT') => prisma.campaignTemplate.create({
    data: {
      tenantId: TENANT,
      name: `tpl-${headerFormat}`,
      metaTemplate: `tpl_${headerFormat.toLowerCase()}`,
      bodyPreview: 'Hello',
      status: 'APPROVED',
      category: 'MARKETING',
      headerFormat,
    },
  });

  const post = (body: Record<string, unknown>) =>
    request(app).post('/api/campaigns').set(auth(token)).send(body);

  it("**refuses another workspace's media**", async () => {
    // The id arrives from the client. Taken at face value, one workspace could attach
    // another's file and have our public route serve it under their campaign.
    const theirs = await uploadPng(otherToken, 'theirs.png').expect(201);
    const template = await templateWith('IMAGE');
    await post({ name: 'X', templateId: template.id, headerMediaId: theirs.body.data.id })
      .expect(404);
  });

  it('refuses a file of the wrong kind for the header', async () => {
    const template = await templateWith('DOCUMENT');
    const image = await uploadPng().expect(201);
    const response = await post({
      name: 'X', templateId: template.id, headerMediaId: image.body.data.id,
    }).expect(400);
    expect(response.body.message).toMatch(/needs a document/);
  });

  it('accepts a matching file', async () => {
    const template = await templateWith('IMAGE');
    const image = await uploadPng().expect(201);
    const response = await post({
      name: 'X', templateId: template.id, headerMediaId: image.body.data.id,
    }).expect(201);
    expect(response.body.data.headerMediaId).toBe(image.body.data.id);
  });
});

describe('sending a media template', () => {
  const readyCampaign = async (headerFormat: 'NONE' | 'IMAGE', attachMedia: boolean) => {
    const template = await prisma.campaignTemplate.create({
      data: {
        tenantId: TENANT,
        name: `send-${headerFormat}-${attachMedia}`,
        metaTemplate: 'promo_v1',
        bodyPreview: 'Hello',
        status: 'APPROVED',
        category: 'MARKETING',
        headerFormat,
      },
    });

    const media = attachMedia
      ? (await uploadPng(token, 'promo.png').expect(201)).body.data
      : null;

    // One customer who may be marketed to, so the audience is not empty.
    await prisma.customer.create({
      data: { tenantId: TENANT, waId: '15557001000', marketingOptIn: true },
    });

    const campaign = await prisma.campaign.create({
      data: {
        tenantId: TENANT,
        name: 'Promo',
        templateId: template.id,
        headerMediaId: media?.id ?? null,
      },
    });
    return { campaignId: campaign.id, media };
  };

  it('**refuses to start an image template with no image**', async () => {
    const { campaignId } = await readyCampaign('IMAGE', false);
    await expect(startCampaign(TENANT, campaignId)).rejects.toThrow(/needs a.*image/i);
  });

  it('sends the header with the media link when one is attached', async () => {
    const { campaignId, media } = await readyCampaign('IMAGE', true);
    await startCampaign(TENANT, campaignId);
    await sendCampaignBatch(campaignId, 10);

    // The mock records what it was asked to send, which is the only way to assert that the
    // header actually went — a send with a silently missing header looks identical
    // otherwise.
    const sent = mockProviderFor(channelId).sent.filter((m) => m.kind === 'template');
    expect(sent).toHaveLength(1);
    const headerMedia = (sent[0]!.meta as { headerMedia?: { kind: string; link: string } }).headerMedia;
    expect(headerMedia?.kind).toBe('IMAGE');
    expect(headerMedia?.link).toContain(`/media/${media.id}/`);
  });

  it('sends no header for a template that has none', async () => {
    const { campaignId } = await readyCampaign('NONE', false);
    await startCampaign(TENANT, campaignId);
    await sendCampaignBatch(campaignId, 10);

    const sent = mockProviderFor(channelId).sent.filter((m) => m.kind === 'template');
    expect((sent[0]!.meta as { headerMedia?: unknown }).headerMedia).toBeUndefined();
  });
});

// ── Sending a file from the Inbox ─────────────────────────────────────────────

describe('an agent sending a customer a file', () => {
  /** A conversation with an inbound message `agoHours` old, which is what opens the window. */
  const conversationAged = async (agoHours: number | null) => {
    const customer = await prisma.customer.create({
      data: { tenantId: TENANT, waId: `1555700${Math.floor(Math.random() * 9000) + 1000}` },
    });
    const conversation = await prisma.conversation.create({
      data: { tenantId: TENANT, customerId: customer.id, status: 'OPEN' },
    });
    if (agoHours !== null) {
      await prisma.message.create({
        data: {
          tenantId: TENANT,
          conversationId: conversation.id,
          customerId: customer.id,
          direction: 'INBOUND',
          type: 'TEXT',
          body: 'hello',
          createdAt: new Date(Date.now() - agoHours * 60 * 60 * 1000),
        },
      });
    }
    return conversation;
  };

  const send = (conversationId: string, body: Record<string, unknown>) => request(app)
    .post(`/api/inbox/conversations/${conversationId}/media`)
    .set(auth(token))
    .send(body);

  it('**sends the file and puts it in the thread**', async () => {
    // Both halves matter. A send the agent cannot see afterwards is the bug that made every
    // bot reply invisible in this inbox for months.
    const conversation = await conversationAged(1);
    const asset = (await uploadPng(token, 'receipt.png').expect(201)).body.data;

    const response = await send(conversation.id, { mediaId: asset.id, caption: 'Your receipt' })
      .expect(201);

    const sent = mockProviderFor(channelId).sent.filter((m) => m.kind === 'media');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.meta).toMatchObject({ mediaKind: 'IMAGE' });
    expect((sent[0]!.meta as { link: string }).link).toContain(`/media/${asset.id}/`);
    expect(sent[0]!.body).toBe('Your receipt');

    expect(response.body.data.direction).toBe('OUTBOUND');
    expect(response.body.data.type).toBe('IMAGE');
    // The authenticated path, not the public link — the thread is read by an agent.
    expect(response.body.data.mediaUrl).toBe(`/api/media/${asset.id}/file`);

    // Asserted on the row the Inbox will actually read back, not only on the response. The
    // two used to be built separately, so a stored row with no url still answered correctly.
    const stored = await prisma.message.findUnique({ where: { id: response.body.data.id } });
    expect(stored?.mediaUrl).toBe(`/api/media/${asset.id}/file`);
    expect(stored?.type).toBe('IMAGE');
    expect(stored?.sentByUserId).not.toBeNull();
  });

  it('describes a file sent with no caption, rather than leaving the bubble empty', async () => {
    const conversation = await conversationAged(1);
    const asset = (await uploadPng(token, 'plan.png').expect(201)).body.data;

    const response = await send(conversation.id, { mediaId: asset.id }).expect(201);
    // The same wording an inbound file gets, so a thread reads consistently either way.
    expect(response.body.data.body).toBe('[photo]');
  });

  it('**refuses outside the 24-hour window**', async () => {
    /*
     * Not merely blocked — impossible. Outside the window WhatsApp accepts templates only, and
     * a template's media is fixed at approval, so there is no version of this send that would
     * have worked. Refusing here means the agent is told, instead of a Meta error they cannot
     * act on.
     */
    const conversation = await conversationAged(25);
    const asset = (await uploadPng(token, 'late.png').expect(201)).body.data;

    const response = await send(conversation.id, { mediaId: asset.id }).expect(400);
    expect(response.body.message).toMatch(/24 hours/i);
    expect(mockProviderFor(channelId).sent.filter((m) => m.kind === 'media')).toHaveLength(0);
  });

  it('refuses when the customer has never written', async () => {
    const conversation = await conversationAged(null);
    const asset = (await uploadPng(token, 'cold.png').expect(201)).body.data;

    const response = await send(conversation.id, { mediaId: asset.id }).expect(400);
    expect(response.body.message).toMatch(/never messaged/i);
  });

  it("**will not forward a customer's own file back to them**", async () => {
    /*
     * An INBOUND asset is deliberately unreachable on the public route — that is what stops a
     * photograph of somebody's ID being served to anyone holding the URL. Meta fetches the
     * link itself, so forwarding one would fail at Meta with a download error and read like
     * our bug. Refused here, with the reason.
     */
    const conversation = await conversationAged(1);
    const inbound = await prisma.mediaAsset.create({
      data: {
        tenantId: TENANT,
        kind: 'IMAGE',
        mimeType: 'image/png',
        sizeBytes: 10,
        originalName: 'their-photo.png',
        storageKey: `tenants/${TENANT}/inbound/2026/08/x.png`,
        source: 'INBOUND',
      },
    });

    const response = await send(conversation.id, { mediaId: inbound.id }).expect(400);
    expect(response.body.message).toMatch(/came from a customer/i);
  });

  it('cannot send another workspace\'s file', async () => {
    const conversation = await conversationAged(1);
    const theirs = (await uploadPng(otherToken, 'theirs.png').expect(201)).body.data;

    await send(conversation.id, { mediaId: theirs.id }).expect(404);
  });

  it('cannot send into another workspace\'s conversation', async () => {
    const conversation = await conversationAged(1);
    const asset = (await uploadPng(token, 'mine.png').expect(201)).body.data;

    await request(app)
      .post(`/api/inbox/conversations/${conversation.id}/media`)
      .set(auth(otherToken))
      .send({ mediaId: asset.id })
      .expect(404);
  });

  it('needs a signed-in agent', async () => {
    const conversation = await conversationAged(1);
    await request(app)
      .post(`/api/inbox/conversations/${conversation.id}/media`)
      .send({ mediaId: '11111111-1111-4111-8111-111111111111' })
      .expect(401);
  });
});
