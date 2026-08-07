import { Router } from 'express';
import { requireAuth, requireModule, requirePermission } from '../../middleware/auth.js';
import {
  getCampaign, getConsentSummary, listCampaignRecipients, listCampaigns, listTemplates,
  patchTemplate, postAudiencePreview, postCampaign, postCampaignPause, postCampaignStart,
  patchCampaign, postCampaignTest, postTemplate, postTemplateSync, removeCampaign,
} from './campaign.controller.js';

// Marketing.
//
// `requireModule('MARKETING')` once, module-wide. Same shape as Leads and
// Support — a module where one endpoint forgot the gate is not gated.

const router = Router();

router.use(requireAuth);
router.use(requireModule('MARKETING'));

// Templates. Literal paths before `/:campaignId`, or the parameter route eats them.
router.get('/templates', requirePermission('campaigns:read'), listTemplates);
router.post('/templates', requirePermission('campaigns:write'), postTemplate);
// Reads from Meta and writes rows, so `campaigns:write`. Ahead of `/templates/:templateId`,
// or "sync" is taken for a template id.
router.post('/templates/sync', requirePermission('campaigns:write'), postTemplateSync);
router.patch('/templates/:templateId', requirePermission('campaigns:write'), patchTemplate);

// A count, not a send — `campaigns:read` is enough.
router.post('/audience-preview', requirePermission('campaigns:read'), postAudiencePreview);
router.get('/consent', requirePermission('campaigns:read'), getConsentSummary);

// A real message to one number, so `campaigns:send` — the same authority as pressing start.
// Literal path, so it stays above `/:campaignId`.
router.post('/test', requirePermission('campaigns:send'), postCampaignTest);

router.get('/', requirePermission('campaigns:read'), listCampaigns);
router.post('/', requirePermission('campaigns:write'), postCampaign);

router.get('/:campaignId', requirePermission('campaigns:read'), getCampaign);
// Drafting, not sending: `campaigns:write`. The service refuses anything that has already
// started, whoever is asking — a campaign that reached somebody is a record of what was sent.
router.patch('/:campaignId', requirePermission('campaigns:write'), patchCampaign);
router.delete('/:campaignId', requirePermission('campaigns:write'), removeCampaign);
router.get('/:campaignId/recipients', requirePermission('campaigns:read'), listCampaignRecipients);

// The only two that actually reach a customer's phone, and the only two behind
// `campaigns:send`. Pausing is deliberately on the same permission: whoever can
// start a send must be able to stop it without finding someone else.
router.post('/:campaignId/start', requirePermission('campaigns:send'), postCampaignStart);
router.post('/:campaignId/pause', requirePermission('campaigns:send'), postCampaignPause);

export default router;
