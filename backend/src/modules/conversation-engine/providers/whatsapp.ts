import type { WhatsappAccount } from '@prisma/client';
import { env } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';
import {
  sendInteractiveButtons, sendInteractiveList, sendMediaMessage, sendTemplate, sendTextMessage,
  type TemplateComponent,
} from '../../../services/whatsapp.service.js';
import type { WhatsAppSender } from '../engine/types.js';
import { MockWhatsAppProvider } from './mock.js';

// WhatsApp adapters.
//
// The engine only ever sees the WhatsAppSender interface, so which of these is
// wired in is a deployment decision rather than a code change — and a test can
// never reach a real phone because `env.ts` selects the mock under NODE_ENV=test.

/** The real Meta Cloud API, bound to one tenant's channel. */
export class MetaWhatsAppProvider implements WhatsAppSender {
  constructor(private readonly channel: WhatsappAccount) {}

  private get credentials() {
    return {
      accessToken: this.channel.accessToken,
      phoneNumberId: this.channel.phoneNumberId,
    };
  }

  async sendText({ to, body }: { to: string; body: string }) {
    const sent = await sendTextMessage({ ...this.credentials, to, body });
    return { messageId: sent?.messages?.[0]?.id ?? null };
  }

  async sendMedia({ to, kind, link, caption, filename }: {
    to: string;
    kind: 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'AUDIO';
    link: string;
    caption?: string | null;
    filename?: string | null;
  }) {
    const sent = await sendMediaMessage({ ...this.credentials, to, kind, link, caption, filename });
    return { messageId: sent?.messages?.[0]?.id ?? null };
  }

  async sendButtons({ to, body, buttons }: {
    to: string; body: string; buttons: Array<{ id: string; title: string }>;
  }) {
    const sent = await sendInteractiveButtons({ ...this.credentials, to, body, buttons });
    return { messageId: sent?.messages?.[0]?.id ?? null };
  }

  async sendList({ to, body, button, sections }: {
    to: string;
    body: string;
    button: string;
    sections: Array<{ title?: string; rows: Array<{ id: string; title: string; description?: string }> }>;
  }) {
    const sent = await sendInteractiveList({ ...this.credentials, to, body, button, sections });
    return { messageId: sent?.messages?.[0]?.id ?? null };
  }

  async sendTemplate({ to, templateName, language, params, headerMedia }: {
    to: string; templateName: string; language: string; params: string[];
    headerMedia?: { kind: 'IMAGE' | 'VIDEO' | 'DOCUMENT'; link: string; filename?: string };
  }) {
    const components: TemplateComponent[] = [];

    // Header first. Meta requires components in template order, and it rejects the message
    // rather than reordering them.
    if (headerMedia) {
      const key = headerMedia.kind.toLowerCase() as 'image' | 'video' | 'document';
      components.push({
        type: 'header',
        parameters: [{
          type: key,
          // `link`, not `id`: the asset lives on our own public media route rather than in
          // Meta's media store, so there is nothing to pre-upload and nothing to expire.
          [key]: {
            link: headerMedia.link,
            // Only a document header shows a filename, and Meta rejects the field on the
            // others.
            ...(key === 'document' && headerMedia.filename
              ? { filename: headerMedia.filename }
              : {}),
          },
        }],
      });
    }

    if (params.length) {
      components.push({ type: 'body', parameters: params.map((p) => ({ type: 'text', text: p })) });
    }

    const sent = await sendTemplate({
      ...this.credentials, to, templateName, language, components,
    });
    return { messageId: sent?.messages?.[0]?.id ?? null };
  }
}

/** Logs what would be sent. Useful for local development without credentials. */
export class ConsoleWhatsAppProvider implements WhatsAppSender {
  private counter = 0;

  private log(kind: string, to: string, body: string, meta?: Record<string, unknown>) {
    this.counter += 1;
    // Deliberately not `logger.info(body)` at info level with the text inline:
    // message bodies are customer content, so they stay at debug.
    logger.debug('[console-whatsapp] outbound', { kind, to, body, ...meta });
    return { messageId: `console.${this.counter}` };
  }

  async sendText({ to, body }: { to: string; body: string }) {
    return this.log('text', to, body);
  }

  async sendMedia({ to, kind, link, caption, filename }: {
    to: string;
    kind: 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'AUDIO';
    link: string;
    caption?: string | null;
    filename?: string | null;
  }) {
    return this.log('media', to, caption ?? '', { mediaKind: kind, link, filename });
  }

  async sendButtons({ to, body, buttons }: {
    to: string; body: string; buttons: Array<{ id: string; title: string }>;
  }) {
    return this.log('buttons', to, body, { buttons: buttons.length });
  }

  async sendList({ to, body, sections }: {
    to: string;
    body: string;
    button: string;
    sections: Array<{ title?: string; rows: Array<{ id: string; title: string; description?: string }> }>;
  }) {
    return this.log('list', to, body, { rows: sections.reduce((n, s) => n + s.rows.length, 0) });
  }

  async sendTemplate({ to, templateName, language }: {
    to: string; templateName: string; language: string; params: string[];
  }) {
    return this.log('template', to, templateName, { language });
  }
}

/**
 * A provider that records instead of sending, kept per-process so the simulator
 * can read back what a dry run "sent".
 */
const mockRegistry = new Map<string, MockWhatsAppProvider>();

export const mockProviderFor = (key: string): MockWhatsAppProvider => {
  const existing = mockRegistry.get(key);
  if (existing) return existing;
  const created = new MockWhatsAppProvider();
  mockRegistry.set(key, created);
  return created;
};

export const clearMockProviders = (): void => { mockRegistry.clear(); };

/**
 * Marks a channel that has no real Meta credentials — the seeded demo, and
 * anything created by the simulator.
 *
 * Without this, a demo channel would be handed the Meta adapter and every send
 * would 400 on a fake token. Setting WHATSAPP_PROVIDER=mock globally would
 * "fix" it by silencing sends for *real* tenants on the same server, which is
 * much worse. A real Cloud API token is a long opaque string and never starts
 * with this prefix, so the sentinel cannot collide with one.
 */
export const MOCK_CHANNEL_TOKEN_PREFIX = 'mock-token-';

export const isSimulatedChannel = (channel: WhatsappAccount): boolean =>
  channel.accessToken.startsWith(MOCK_CHANNEL_TOKEN_PREFIX);

/**
 * Pick the adapter for a channel.
 *
 * `mock` and `console` ignore the channel's credentials entirely, which is what
 * makes it safe to run the engine against a tenant whose token is expired or
 * absent.
 */
export const whatsappProviderFor = (
  channel: WhatsappAccount,
  override?: 'meta' | 'mock' | 'console',
): WhatsAppSender => {
  // A channel with no real credentials is always mocked, whatever the env says.
  // This is per-channel on purpose: one server can host a live tenant and the
  // hospital demo at once, and only the demo should have its sends swallowed.
  if (!override && isSimulatedChannel(channel)) return mockProviderFor(channel.id);

  const kind = override ?? env.engine.whatsappProvider;
  switch (kind) {
    case 'mock': return mockProviderFor(channel.id);
    case 'console': return new ConsoleWhatsAppProvider();
    case 'meta': return new MetaWhatsAppProvider(channel);
    default:
      logger.warn('Unknown WHATSAPP_PROVIDER, falling back to console', { kind });
      return new ConsoleWhatsAppProvider();
  }
};
