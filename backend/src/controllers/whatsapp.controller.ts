import { channelForTenant } from '../services/whatsapp-account.service.js';
import { tenantIdOf } from '../middleware/auth.js';
import { prisma } from '../config/prisma.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { assertCanAddWhatsappNumber } from '../modules/billing/limits.js';
import {
  exchangeCodeForToken,
  exchangeShortTokenForLongToken,
  subscribeAppToWaba,
  registerPhoneNumber,
  graphHttp,
} from '../services/whatsapp.service.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

// Module 2: WhatsApp embedded signup v4 completion.
// Frontend opens FB.login with config_id and posts the resulting code + WABA + phone here.
export const completeEmbeddedSignup = asyncHandler(async (req, res) => {
  const { code, wabaId, phoneNumberId, displayPhone, businessName } = req.body;

  let accessToken = req.body.accessToken;
  let expiresIn = 0;
  if (code && !accessToken) {
    try {
      const tokenRes = await exchangeCodeForToken(code);
      accessToken = tokenRes.access_token;
      expiresIn = tokenRes.expires_in || 0;
    } catch (err: any) {
      throw ApiError.badRequest(err.response?.data?.error?.message || err.message || 'Failed to exchange signup code');
    }
  }
  if (!accessToken) throw ApiError.badRequest('Missing access token / code');

  // Exchange the access token for a long-lived one to ensure it doesn't expire quickly
  let finalToken = accessToken;
  let tokenExpiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;

  try {
    const exchangeRes = await exchangeShortTokenForLongToken(accessToken);
    finalToken = exchangeRes.access_token;
    if (exchangeRes.expires_in) {
      tokenExpiresAt = new Date(Date.now() + exchangeRes.expires_in * 1000);
    }
  } catch (err: any) {
    // If the exchange fails, it might be a System User token or an already long-lived token.
    // Validate it against the Graph API first to ensure it's functional.
    try {
      await graphHttp.get(
        `https://graph.facebook.com/${env.meta.graphVersion}/${wabaId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      // Valid token, we keep the original one and set expiration to null (permanent/unknown)
    } catch (validationErr) {
      throw ApiError.badRequest(err.response?.data?.error?.message || err.message || 'Invalid access token / exchange failed');
    }
  }

  // The number limit applies to *connecting a new* number, not to reconnecting
  // one that already exists — a token refresh on an existing number must never
  // be refused because the workspace is at its plan limit.
  const alreadyConnected = await prisma.whatsappAccount.findUnique({
    where: { tenantId_phoneNumberId: { tenantId: tenantIdOf(req), phoneNumberId } },
    select: { id: true },
  });
  if (!alreadyConnected) await assertCanAddWhatsappNumber(tenantIdOf(req));

  // Conflict target is (tenantId, phoneNumberId), so reconnecting the SAME
  // number updates in place and connecting a second number inserts — both in
  // one atomic statement, with no find-then-write race.
  const account = await prisma.whatsappAccount.upsert({
    where: { tenantId_phoneNumberId: { tenantId: tenantIdOf(req), phoneNumberId } },
    update: { wabaId, phoneNumberId, displayPhone, businessName, accessToken: finalToken, tokenExpiresAt },
    create: { tenantId: tenantIdOf(req), wabaId, phoneNumberId, displayPhone, businessName, accessToken: finalToken, tokenExpiresAt },
  });

  // Post-signup activation. Deliberately non-fatal and run *after* the upsert:
  // the token is the hard-to-recover part, so we never discard a good token
  // because an activation call failed. Failures are reported back so the UI can
  // prompt a retry instead of silently looking connected but receiving nothing.
  const activation = await activateAccount({
    accessToken: finalToken,
    wabaId,
    phoneNumberId,
    pin: req.body.pin,
  });

  res.status(201).json({
    success: true,
    data: {
      id: account.id,
      wabaId: account.wabaId,
      phoneNumberId: account.phoneNumberId,
      displayPhone: account.displayPhone,
      connectedAt: account.connectedAt,
      activation,
    },
  });
});

// Runs the two Graph calls a WABA needs before it is usable:
//   1. subscribed_apps — without it Meta delivers no webhooks for this WABA.
//   2. /register       — without it the phone number cannot send via Cloud API.
// Returns a per-step status rather than throwing, so a partial failure is
// visible without rolling back a successful connection.
interface ActivationResult {
  webhookSubscribed: boolean;
  phoneRegistered: boolean;
  warnings: string[];
}

const activateAccount = async ({ accessToken, wabaId, phoneNumberId, pin }: {
  accessToken: string;
  wabaId: string;
  phoneNumberId: string;
  pin?: string;
}): Promise<ActivationResult> => {
  const result: ActivationResult = { webhookSubscribed: false, phoneRegistered: false, warnings: [] };

  try {
    await subscribeAppToWaba({ accessToken, wabaId });
    result.webhookSubscribed = true;
    logger.info('Subscribed app to WABA webhooks', { wabaId });
  } catch (err: any) {
    const msg = err.response?.data?.error?.message || err.message;
    result.warnings.push(`Webhook subscription failed: ${msg}. Inbound messages will not arrive until this succeeds.`);
    logger.error('WABA webhook subscription failed', { wabaId, error: msg });
  }

  const effectivePin = pin || env.meta.defaultPhonePin;
  if (!effectivePin) {
    result.warnings.push('Phone registration skipped: no PIN supplied (set META_DEFAULT_PHONE_PIN or pass `pin`). The number cannot send until registered.');
    logger.warn('Phone registration skipped — no PIN available', { phoneNumberId });
    return result;
  }

  try {
    await registerPhoneNumber({ accessToken, phoneNumberId, pin: effectivePin });
    result.phoneRegistered = true;
    logger.info('Registered phone number for Cloud API', { phoneNumberId });
  } catch (err: any) {
    const msg = err.response?.data?.error?.message || err.message;
    // Already-registered is a success for our purposes, not a failure.
    if (/already/i.test(msg)) {
      result.phoneRegistered = true;
      logger.info('Phone number already registered', { phoneNumberId });
    } else {
      result.warnings.push(`Phone registration failed: ${msg}. The number cannot send until registered.`);
      logger.error('Phone registration failed', { phoneNumberId, error: msg });
    }
  }

  return result;
};

export const getWhatsappAccount = asyncHandler(async (req, res) => {
  const account = await channelForTenant(tenantIdOf(req));
  if (!account) return res.json({ success: true, data: null });

  let tokenExpired = false;
  try {
    await graphHttp.get(
      `https://graph.facebook.com/${env.meta.graphVersion}/${account.wabaId}`,
      { headers: { Authorization: `Bearer ${account.accessToken}` } }
    );
  } catch (err: any) {
    if (err.response?.data?.error?.code === 190 || err.response?.status === 401) {
      tokenExpired = true;
    }
  }

  // Never return raw token.
  res.json({
    success: true,
    data: {
      id: account.id,
      wabaId: account.wabaId,
      phoneNumberId: account.phoneNumberId,
      displayPhone: account.displayPhone,
      businessName: account.businessName,
      connectedAt: account.connectedAt,
      tokenExpiresAt: account.tokenExpiresAt,
      tokenExpired,
    },
  });
});

export const disconnectWhatsapp = asyncHandler(async (req, res) => {
  await prisma.whatsappAccount.deleteMany({ where: { tenantId: tenantIdOf(req) } });
  res.json({ success: true });
});

// Public config so frontend can launch FB.login.
export const embeddedSignupConfig = asyncHandler(async (_req, res) => {
  res.json({
    success: true,
    data: {
      appId: env.meta.appId,
      configId: env.meta.configId,
      graphVersion: env.meta.graphVersion,
    },
  });
});

// Update access token manually (e.g. if expired)
export const updateAccessToken = asyncHandler(async (req, res) => {
  const { accessToken } = req.body;
  if (!accessToken) throw ApiError.badRequest('Missing access token');

  const account = await channelForTenant(tenantIdOf(req));
  if (!account) throw ApiError.notFound('WhatsApp account not connected');

  let finalToken = accessToken;
  let tokenExpiresAt = null;

  try {
    const exchangeRes = await exchangeShortTokenForLongToken(accessToken);
    finalToken = exchangeRes.access_token;
    if (exchangeRes.expires_in) {
      tokenExpiresAt = new Date(Date.now() + exchangeRes.expires_in * 1000);
    }
  } catch (err: any) {
    // If the exchange fails, it might be a System User token or an already long-lived token.
    // Validate it against the Graph API first to ensure it's functional.
    try {
      await graphHttp.get(
        `https://graph.facebook.com/${env.meta.graphVersion}/${account.wabaId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      // Valid token, we keep the original one and set expiration to null (permanent/unknown)
    } catch (validationErr) {
      throw ApiError.badRequest(err.response?.data?.error?.message || err.message || 'Invalid access token / exchange failed');
    }
  }

  await prisma.whatsappAccount.update({
    where: { id: account.id },
    data: { accessToken: finalToken, tokenExpiresAt },
  });

  res.json({ success: true, message: 'Token updated successfully' });
});

