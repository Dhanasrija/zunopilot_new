import axios from 'axios';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const graphUrl = (path) => `https://graph.facebook.com/${env.meta.graphVersion}${path}`;

// Send a free-form text message inside the 24h customer service window.
export const sendTextMessage = async ({ accessToken, phoneNumberId, to, body }) => {
  try {
    const { data } = await axios.post(
      graphUrl(`/${phoneNumberId}/messages`),
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body, preview_url: false },
      },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return data;
  } catch (err) {
    logger.error('sendTextMessage failed', { error: err.response?.data || err.message });
    throw err;
  }
};

export const sendInteractiveList = async ({ accessToken, phoneNumberId, to, header, body, button, sections }) => {
  try {
    const { data } = await axios.post(
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
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return data;
  } catch (err) {
    logger.error('sendInteractiveList failed', { error: err.response?.data || err.message });
    throw err;
  }
};

export const sendInteractiveButtons = async ({ accessToken, phoneNumberId, to, body, buttons }) => {
  try {
    const { data } = await axios.post(
      graphUrl(`/${phoneNumberId}/messages`),
      {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: body },
          action: { buttons: buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })) },
        },
      },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return data;
  } catch (err) {
    logger.error('sendInteractiveButtons failed', { error: err.response?.data || err.message });
    throw err;
  }
};

export const sendTemplate = async ({ accessToken, phoneNumberId, to, templateName, language = 'en', components = [] }) => {
  try {
    const { data } = await axios.post(
      graphUrl(`/${phoneNumberId}/messages`),
      {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: { name: templateName, language: { code: language }, components },
      },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return data;
  } catch (err) {
    logger.error('sendTemplate failed', { error: err.response?.data || err.message });
    throw err;
  }
};

// Exchange code from Embedded Signup for a long-lived/system access token.
export const exchangeCodeForToken = async (code) => {
  const { data } = await axios.get(graphUrl('/oauth/access_token'), {
    params: {
      client_id: env.meta.appId,
      client_secret: env.meta.appSecret,
      code,
    },
  });
  return data; // { access_token, token_type, expires_in }
};

// Exchange a short-lived token for a long-lived token.
export const exchangeShortTokenForLongToken = async (shortLivedToken) => {
  const { data } = await axios.get(graphUrl('/oauth/access_token'), {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: env.meta.appId,
      client_secret: env.meta.appSecret,
      fb_exchange_token: shortLivedToken,
    },
  });
  return data; // { access_token, token_type, expires_in }
};

export const fetchWabaInfo = async (accessToken) => {
  const { data } = await axios.get(graphUrl('/debug_token'), {
    params: { input_token: accessToken, access_token: `${env.meta.appId}|${env.meta.appSecret}` },
  });
  return data;
};

// Fetch a single template by ID from Meta.
export const fetchMetaTemplate = async ({ accessToken, templateId }) => {
  try {
    const { data } = await axios.get(
      graphUrl(`/${templateId}`),
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { fields: 'id,name,category,language,status,components,created_time,last_updated_time' },
      }
    );
    return data;
  } catch (err) {
    logger.error('fetchMetaTemplate failed', { error: err.response?.data || err.message });
    throw err;
  }
};

// Fetch message templates from WABA.
export const fetchMetaTemplates = async ({ accessToken, wabaId }) => {
  try {
    const { data } = await axios.get(
      graphUrl(`/${wabaId}/message_templates`),
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { limit: 100 }
      }
    );
    return data;
  } catch (err) {
    logger.error('fetchMetaTemplates failed', { error: err.response?.data || err.message });
    throw err;
  }
};

// Create message template on WABA.
export const createMetaTemplate = async ({ accessToken, wabaId, name, category, language, components }) => {
  try {
    const { data } = await axios.post(
      graphUrl(`/${wabaId}/message_templates`),
      {
        name,
        category,
        language,
        components,
      },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return data;
  } catch (err) {
    logger.error('createMetaTemplate failed', { error: err.response?.data || err.message });
    throw err;
  }
};

// Delete message template from WABA.
export const deleteMetaTemplate = async ({ accessToken, wabaId, name }) => {
  try {
    const { data } = await axios.delete(
      graphUrl(`/${wabaId}/message_templates`),
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { name }
      }
    );
    return data;
  } catch (err) {
    logger.error('deleteMetaTemplate failed', { error: err.response?.data || err.message });
    throw err;
  }
};

// Edit message template on WABA.
export const updateMetaTemplate = async ({ accessToken, templateId, components }) => {
  try {
    const { data } = await axios.post(
      graphUrl(`/${templateId}`),
      { components },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return data;
  } catch (err) {
    logger.error('updateMetaTemplate failed', { error: err.response?.data || err.message });
    throw err;
  }
};


