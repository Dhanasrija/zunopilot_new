import axios from 'axios';
import { prisma } from '../config/prisma.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { exchangeCodeForToken, exchangeShortTokenForLongToken } from '../services/whatsapp.service.js';
import { env } from '../config/env.js';

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
    } catch (err) {
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
  } catch (err) {
    // If the exchange fails, it might be a System User token or an already long-lived token.
    // Validate it against the Graph API first to ensure it's functional.
    try {
      await axios.get(
        `https://graph.facebook.com/${env.meta.graphVersion}/${wabaId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      // Valid token, we keep the original one and set expiration to null (permanent/unknown)
    } catch (validationErr) {
      throw ApiError.badRequest(err.response?.data?.error?.message || err.message || 'Invalid access token / exchange failed');
    }
  }

  const account = await prisma.whatsappAccount.upsert({
    where: { tenantId: req.tenantId },
    update: { wabaId, phoneNumberId, displayPhone, businessName, accessToken: finalToken, tokenExpiresAt },
    create: { tenantId: req.tenantId, wabaId, phoneNumberId, displayPhone, businessName, accessToken: finalToken, tokenExpiresAt },
  });

  res.status(201).json({
    success: true,
    data: { id: account.id, wabaId: account.wabaId, phoneNumberId: account.phoneNumberId, displayPhone: account.displayPhone, connectedAt: account.connectedAt },
  });
});

export const getWhatsappAccount = asyncHandler(async (req, res) => {
  const account = await prisma.whatsappAccount.findUnique({ where: { tenantId: req.tenantId } });
  if (!account) return res.json({ success: true, data: null });

  let tokenExpired = false;
  try {
    await axios.get(
      `https://graph.facebook.com/${env.meta.graphVersion}/${account.wabaId}`,
      { headers: { Authorization: `Bearer ${account.accessToken}` } }
    );
  } catch (err) {
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
  await prisma.whatsappAccount.deleteMany({ where: { tenantId: req.tenantId } });
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

  const account = await prisma.whatsappAccount.findUnique({ where: { tenantId: req.tenantId } });
  if (!account) throw ApiError.notFound('WhatsApp account not connected');

  let finalToken = accessToken;
  let tokenExpiresAt = null;

  try {
    const exchangeRes = await exchangeShortTokenForLongToken(accessToken);
    finalToken = exchangeRes.access_token;
    if (exchangeRes.expires_in) {
      tokenExpiresAt = new Date(Date.now() + exchangeRes.expires_in * 1000);
    }
  } catch (err) {
    // If the exchange fails, it might be a System User token or an already long-lived token.
    // Validate it against the Graph API first to ensure it's functional.
    try {
      await axios.get(
        `https://graph.facebook.com/${env.meta.graphVersion}/${account.wabaId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      // Valid token, we keep the original one and set expiration to null (permanent/unknown)
    } catch (validationErr) {
      throw ApiError.badRequest(err.response?.data?.error?.message || err.message || 'Invalid access token / exchange failed');
    }
  }

  await prisma.whatsappAccount.update({
    where: { tenantId: req.tenantId },
    data: { accessToken: finalToken, tokenExpiresAt },
  });

  res.json({ success: true, message: 'Token updated successfully' });
});

