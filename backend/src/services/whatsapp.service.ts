import axios from 'axios';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

// Thin transport over Meta's Graph API.
//
// Everything here is a direct HTTP call — no business rules, no persistence.
// Phase 4 wraps this in a WhatsAppProvider so tests and the simulator can swap
// in a mock; this module stays the real Meta adapter underneath it.

const graphUrl = (path: string) => `https://graph.facebook.com/${env.meta.graphVersion}${path}`;

/**
 * One client for every Graph call, so all of them inherit a timeout.
 *
 * **Why this is not optional.** These calls used bare `axios.post`, and axios has no default
 * timeout — a request whose TCP connection stalls rather than fails will wait forever, because
 * nothing in Node will time it out. That matters more than it sounds: a send happens inside the
 * inbound job, and the worker's batch handler awaits `Promise.all` over its jobs. A promise that
 * never settles is not something `try/catch` can rescue, so one stalled socket to Meta used to
 * stop the inbound queue fetching for **every tenant** until the process was restarted.
 *
 * `registerWorker` now also bounds each job independently, so this is one of two layers. Both
 * are worth having: this one turns a hang into an ordinary error that the existing retry can
 * handle, which is much better than a job killed from the outside halfway through.
 */
const http = axios.create({ timeout: env.meta.timeoutMs });

/**
 * The same client, for the onboarding controller's own Graph calls.
 *
 * Exported rather than letting that file reach for bare `axios`, so there is exactly one place
 * the Graph timeout is decided. Those calls run in a request handler rather than a worker, so
 * they cannot stall the queue — but a hung one still pins an Express connection and a database
 * connection for as long as it lasts, which on a small pool is its own outage.
 */
export const graphHttp = http;

const authHeaders = (accessToken: string) => ({
  headers: { Authorization: `Bearer ${accessToken}` },
});

/**
 * Meta returns its real diagnostics in the response body, not the HTTP message —
 * `err.message` alone is always the useless "Request failed with status code
 * 400". This pulls out whichever is actually informative.
 */
const describe = (err: unknown): unknown => {
  if (axios.isAxiosError(err)) return err.response?.data ?? err.message;
  return err instanceof Error ? err.message : String(err);
};

/** Run a Graph call, log Meta's own error body on failure, and rethrow. */
const graphCall = async <T>(operation: string, fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (err) {
    logger.error(`${operation} failed`, { error: describe(err) });
    throw err;
  }
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SendResponse {
  messaging_product: string;
  contacts?: Array<{ input: string; wa_id: string }>;
  messages?: Array<{ id: string }>;
}

interface Credentials {
  accessToken: string;
  phoneNumberId: string;
}

export interface ListRow { id: string; title: string; description?: string }
export interface ListSection { title?: string; rows: ListRow[] }
export interface ReplyButton { id: string; title: string }

export interface TemplateComponent {
  type: 'header' | 'body' | 'button';
  sub_type?: string;
  index?: string;
  parameters?: Array<Record<string, unknown>>;
}

// ── Outbound messages ─────────────────────────────────────────────────────────

/** Send a free-form text message inside the 24h customer service window. */
export const sendTextMessage = ({ accessToken, phoneNumberId, to, body }: Credentials & {
  to: string;
  body: string;
}): Promise<SendResponse> =>
  graphCall('sendTextMessage', async () => {
    const { data } = await http.post<SendResponse>(
      graphUrl(`/${phoneNumberId}/messages`),
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body, preview_url: false },
      },
      authHeaders(accessToken),
    );
    return data;
  });

export const sendInteractiveList = ({
  accessToken, phoneNumberId, to, header, body, button, sections,
}: Credentials & {
  to: string;
  header?: string;
  body: string;
  button: string;
  sections: ListSection[];
}): Promise<SendResponse> =>
  graphCall('sendInteractiveList', async () => {
    const { data } = await http.post<SendResponse>(
      graphUrl(`/${phoneNumberId}/messages`),
      {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'list',
          header: header ? { type: 'text', text: header } : undefined,
          body: { text: body },
          action: { button, sections },
        },
      },
      authHeaders(accessToken),
    );
    return data;
  });

export const sendInteractiveButtons = ({
  accessToken, phoneNumberId, to, body, buttons,
}: Credentials & {
  to: string;
  body: string;
  buttons: ReplyButton[];
}): Promise<SendResponse> =>
  graphCall('sendInteractiveButtons', async () => {
    const { data } = await http.post<SendResponse>(
      graphUrl(`/${phoneNumberId}/messages`),
      {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: body },
          action: {
            buttons: buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })),
          },
        },
      },
      authHeaders(accessToken),
    );
    return data;
  });

/**
 * Renders a native "Send location" button. Tapping it opens WhatsApp's own
 * location picker (map + place search); the reply arrives as a webhook message
 * of type `location`.
 *
 * Cannot be sent as a template, so it only works inside the 24-hour customer
 * service window — fine for checkout, where the customer is mid-conversation.
 * Callers should be prepared for this to throw and fall back to a text prompt.
 */
export const sendLocationRequest = ({ accessToken, phoneNumberId, to, body }: Credentials & {
  to: string;
  body: string;
}): Promise<SendResponse> =>
  graphCall('sendLocationRequest', async () => {
    const { data } = await http.post<SendResponse>(
      graphUrl(`/${phoneNumberId}/messages`),
      {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'location_request_message',
          body: { text: body },
          action: { name: 'send_location' },
        },
      },
      authHeaders(accessToken),
    );
    return data;
  });

export const sendTemplate = ({
  accessToken, phoneNumberId, to, templateName, language = 'en', components = [],
}: Credentials & {
  to: string;
  templateName: string;
  language?: string;
  components?: TemplateComponent[];
}): Promise<SendResponse> =>
  graphCall('sendTemplate', async () => {
    const { data } = await http.post<SendResponse>(
      graphUrl(`/${phoneNumberId}/messages`),
      {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: { name: templateName, language: { code: language }, components },
      },
      authHeaders(accessToken),
    );
    return data;
  });

// ── Onboarding / account ──────────────────────────────────────────────────────

export interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

/** Exchange the code from Embedded Signup for a long-lived access token. */
export const exchangeCodeForToken = async (code: string): Promise<TokenResponse> => {
  const { data } = await http.get<TokenResponse>(graphUrl('/oauth/access_token'), {
    params: { client_id: env.meta.appId, client_secret: env.meta.appSecret, code },
  });
  return data;
};

/** Exchange a short-lived token for a long-lived one. */
export const exchangeShortTokenForLongToken = async (shortLivedToken: string): Promise<TokenResponse> => {
  const { data } = await http.get<TokenResponse>(graphUrl('/oauth/access_token'), {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: env.meta.appId,
      client_secret: env.meta.appSecret,
      fb_exchange_token: shortLivedToken,
    },
  });
  return data;
};

/**
 * Subscribe this app to the WABA's webhook events. Required after Embedded
 * Signup: Meta delivers nothing for a freshly onboarded WABA until the app is
 * subscribed to it, so inbound messages never reach the automation engine.
 */
export const subscribeAppToWaba = ({ accessToken, wabaId }: { accessToken: string; wabaId: string }) =>
  graphCall('subscribeAppToWaba', async () => {
    const { data } = await http.post<{ success: boolean }>(
      graphUrl(`/${wabaId}/subscribed_apps`),
      {},
      authHeaders(accessToken),
    );
    return data;
  });

/**
 * Register the phone number for Cloud API messaging. Until this succeeds the
 * number cannot send. `pin` is the number's six-digit two-step verification PIN.
 */
export const registerPhoneNumber = ({ accessToken, phoneNumberId, pin }: Credentials & { pin: string }) =>
  graphCall('registerPhoneNumber', async () => {
    const { data } = await http.post<{ success: boolean }>(
      graphUrl(`/${phoneNumberId}/register`),
      { messaging_product: 'whatsapp', pin },
      authHeaders(accessToken),
    );
    return data;
  });

export const fetchWabaInfo = async (accessToken: string): Promise<Record<string, unknown>> => {
  const { data } = await http.get<Record<string, unknown>>(graphUrl('/debug_token'), {
    params: { input_token: accessToken, access_token: `${env.meta.appId}|${env.meta.appSecret}` },
  });
  return data;
};

// ── Templates ─────────────────────────────────────────────────────────────────

export interface MetaTemplate {
  id: string;
  name: string;
  category?: string;
  language?: string;
  status?: string;
  components?: unknown[];
  created_time?: string;
  last_updated_time?: string;
}

export const fetchMetaTemplate = ({ accessToken, templateId }: { accessToken: string; templateId: string }) =>
  graphCall('fetchMetaTemplate', async () => {
    const { data } = await http.get<MetaTemplate>(graphUrl(`/${templateId}`), {
      ...authHeaders(accessToken),
      params: { fields: 'id,name,category,language,status,components,created_time,last_updated_time' },
    });
    return data;
  });

export const fetchMetaTemplates = ({ accessToken, wabaId }: { accessToken: string; wabaId: string }) =>
  graphCall('fetchMetaTemplates', async () => {
    const { data } = await http.get<{ data: MetaTemplate[] }>(
      graphUrl(`/${wabaId}/message_templates`),
      { ...authHeaders(accessToken), params: { limit: 100 } },
    );
    return data;
  });

export const createMetaTemplate = ({
  accessToken, wabaId, name, category, language, components,
}: {
  accessToken: string;
  wabaId: string;
  name: string;
  category: string;
  language: string;
  components: unknown[];
}) =>
  graphCall('createMetaTemplate', async () => {
    const { data } = await http.post<{ id: string; status?: string; category?: string }>(
      graphUrl(`/${wabaId}/message_templates`),
      { name, category, language, components },
      authHeaders(accessToken),
    );
    return data;
  });

export const deleteMetaTemplate = ({
  accessToken, wabaId, name,
}: { accessToken: string; wabaId: string; name: string }) =>
  graphCall('deleteMetaTemplate', async () => {
    const { data } = await axios.delete<{ success: boolean }>(
      graphUrl(`/${wabaId}/message_templates`),
      { ...authHeaders(accessToken), params: { name } },
    );
    return data;
  });

export const updateMetaTemplate = ({
  accessToken, templateId, components,
}: { accessToken: string; templateId: string; components: unknown[] }) =>
  graphCall('updateMetaTemplate', async () => {
    const { data } = await http.post<{ success: boolean }>(
      graphUrl(`/${templateId}`),
      { components },
      authHeaders(accessToken),
    );
    return data;
  });
