import { channelForTenant } from '../services/whatsapp-account.service.js';
import { tenantIdOf } from '../middleware/auth.js';
import { prisma } from '../config/prisma.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import {
  fetchMetaTemplates,
  fetchMetaTemplate as apiFetchMetaTemplate,
  createMetaTemplate as apiCreateMetaTemplate,
  deleteMetaTemplate as apiDeleteMetaTemplate,
  updateMetaTemplate as apiUpdateMetaTemplate
} from '../services/whatsapp.service.js';

export const listTemplates = asyncHandler(async (req, res) => {
  const templates = await prisma.messageTemplate.findMany({
    where: { tenantId: tenantIdOf(req) },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, data: templates });
});

export const upsertTemplate = asyncHandler(async (req, res) => {
  const { name, trigger, metaTemplate, language = 'en', body, isActive = true } = req.body;
  const template = await prisma.messageTemplate.upsert({
    where: { tenantId_trigger: { tenantId: tenantIdOf(req), trigger } },
    update: { name, metaTemplate, language, body, isActive },
    create: { tenantId: tenantIdOf(req), name, trigger, metaTemplate, language, body, isActive },
  });
  res.status(201).json({ success: true, data: template });
});

export const deleteTemplate = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const t = await prisma.messageTemplate.findFirst({ where: { id, tenantId: tenantIdOf(req) } });
  if (!t) throw ApiError.notFound();
  await prisma.messageTemplate.delete({ where: { id } });
  res.json({ success: true });
});

export const listMetaTemplates = asyncHandler(async (req, res) => {
  const account = await channelForTenant(tenantIdOf(req));
  if (!account || !account.wabaId || !account.accessToken) {
    return res.json({ success: true, connected: false, data: [] });
  }

  try {
    const templatesData = await fetchMetaTemplates({
      accessToken: account.accessToken,
      wabaId: account.wabaId,
    });
    res.json({ success: true, connected: true, data: templatesData.data || [] });
  } catch (err: any) {
    const isTokenError = err.response?.data?.error?.code === 190 || err.response?.status === 401;
    res.status(isTokenError ? 200 : (err.response?.status || 500)).json({
      success: false,
      connected: true,
      tokenExpired: isTokenError,
      message: err.response?.data?.error?.message || err.message || 'Failed to fetch templates from Meta',
    });
  }
});

export const getMetaTemplate = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const account = await channelForTenant(tenantIdOf(req));
  if (!account || !account.accessToken) throw new ApiError(400, 'WhatsApp account not connected');
  try {
    const template = await apiFetchMetaTemplate({ accessToken: account.accessToken, templateId: id });
    res.json({ success: true, data: template });
  } catch (err: any) {
    const isTokenError = err.response?.data?.error?.code === 190 || err.response?.status === 401;
    res.status(isTokenError ? 424 : (err.response?.status || 500)).json({
      success: false,
      tokenExpired: isTokenError,
      message: err.response?.data?.error?.message || err.message || 'Failed to fetch template',
    });
  }
});

export const createMetaTemplate = asyncHandler(async (req, res) => {
  const account = await channelForTenant(tenantIdOf(req));
  if (!account || !account.wabaId || !account.accessToken) {
    throw new ApiError(400, 'WhatsApp account not connected');
  }

  const { name, category, language, components } = req.body;

  try {
    const result = await apiCreateMetaTemplate({
      accessToken: account.accessToken,
      wabaId: account.wabaId,
      name,
      category,
      language,
      components,
    });
    res.status(201).json({ success: true, data: result });
  } catch (err: any) {
    const isTokenError = err.response?.data?.error?.code === 190 || err.response?.status === 401;
    const statusCode = isTokenError ? 424 : (err.response?.status || 500);
    res.status(statusCode).json({
      success: false,
      tokenExpired: isTokenError,
      message: err.response?.data?.error?.message || err.message || 'Failed to create template on Meta',
    });
  }
});

export const deleteMetaTemplate = asyncHandler(async (req, res) => {
  const account = await channelForTenant(tenantIdOf(req));
  if (!account || !account.wabaId || !account.accessToken) {
    throw new ApiError(400, 'WhatsApp account not connected');
  }

  const { name } = req.params;

  try {
    const result = await apiDeleteMetaTemplate({
      accessToken: account.accessToken,
      wabaId: account.wabaId,
      name,
    });
    res.json({ success: true, data: result });
  } catch (err: any) {
    const isTokenError = err.response?.data?.error?.code === 190 || err.response?.status === 401;
    const statusCode = isTokenError ? 424 : (err.response?.status || 500);
    res.status(statusCode).json({
      success: false,
      tokenExpired: isTokenError,
      message: err.response?.data?.error?.message || err.message || 'Failed to delete template on Meta',
    });
  }
});

export const updateMetaTemplate = asyncHandler(async (req, res) => {
  const account = await channelForTenant(tenantIdOf(req));
  if (!account || !account.wabaId || !account.accessToken) {
    throw new ApiError(400, 'WhatsApp account not connected');
  }

  const { id } = req.params;
  const { components } = req.body;

  try {
    const result = await apiUpdateMetaTemplate({
      accessToken: account.accessToken,
      templateId: id,
      components,
    });
    res.json({ success: true, data: result });
  } catch (err: any) {
    const isTokenError = err.response?.data?.error?.code === 190 || err.response?.status === 401;
    const statusCode = isTokenError ? 424 : (err.response?.status || 500);
    res.status(statusCode).json({
      success: false,
      tokenExpired: isTokenError,
      message: err.response?.data?.error?.message || err.message || 'Failed to update template on Meta',
    });
  }
});

