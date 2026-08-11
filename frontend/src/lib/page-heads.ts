import type { PageHead } from './document-head';

/*
 * The head for each public page.
 *
 * Together in one file rather than inline in nine components, because the set has to be read
 * as a set: the titles share a shape, the descriptions must not repeat each other, and every
 * `path` here has to match both the route in App.tsx and the `<loc>` in public/sitemap.xml. A
 * canonical that disagrees with the sitemap is the bug this whole module exists to fix.
 *
 * Lengths are deliberate. Google truncates titles around 60 characters and descriptions around
 * 160; each of these is inside that, so nothing is cut. The home page's two strings are the
 * ones also in index.html and are re-stated here so the table is complete — the static tags
 * remain what non-JS scrapers read, and `document-head.test.ts` asserts the two agree.
 *
 * **Coming Soon pages are deliberately absent.** They set their own head inline with
 * `robots: 'noindex, follow'` and no canonical, and they are not in the sitemap. The test
 * requires this table and the sitemap to be exactly the same set, which is what stops an
 * unwritten page from being advertised for indexing — see the header of `pages/ComingSoon.tsx`.
 */

export const PAGE_HEADS = {
  landing: {
    path: '/',
    title: 'ZunoPilot – AI-Powered WhatsApp Business Automation Platform',
    description:
      'Automate WhatsApp customer communication with ZunoPilot. Use AI-powered workflows, '
      + 'shared conversations, number masking, campaigns, and team collaboration.',
  },
  features: {
    path: '/features',
    title: 'WhatsApp Automation Features | ZunoPilot',
    description:
      "Explore ZunoPilot's WhatsApp automation features, including AI automation, shared team "
      + 'inboxes, number masking, campaigns, and business workflows.',
  },
  solutions: {
    path: '/solutions',
    title: 'WhatsApp Business Solutions & Automation | ZunoPilot',
    description:
      'Discover WhatsApp business solutions from ZunoPilot for lead management, sales, '
      + 'customer support, marketing, and customer engagement.',
  },
  whatsappAutomation: {
    path: '/features/whatsapp-automation',
    title: 'WhatsApp Automation for Business | ZunoPilot',
    description:
      'Automate WhatsApp messages, follow-ups, customer enquiries, notifications, and workflows '
      + "with ZunoPilot's business WhatsApp automation platform.",
  },
  aiWhatsappAutomation: {
    path: '/features/ai-whatsapp-automation',
    title: 'AI WhatsApp Automation for Business | ZunoPilot',
    description:
      'Use AI WhatsApp automation to assist customer conversations, qualify leads, answer '
      + 'routine questions, and connect AI with business workflows.',
  },
  /* ---------------------------- Feature detail ---------------------------- */
  sharedPortal: {
    path: '/features/shared-whatsapp-portal',
    title: 'Shared WhatsApp Portal for Teams | ZunoPilot',
    description:
      'Manage business WhatsApp conversations from one shared portal. Give your team access, '
      + 'keep follow-ups visible, and stop relying on individual phones.',
  },
  numberMasking: {
    path: '/features/whatsapp-number-masking',
    title: 'WhatsApp Number Masking for Business | ZunoPilot',
    description:
      'Reduce exposure of business and personal WhatsApp numbers. Keep customer conversations '
      + 'in a business-managed environment your authorized team can work from.',
  },
  campaigns: {
    path: '/features/whatsapp-campaigns',
    title: 'WhatsApp Campaign Software for Business | ZunoPilot',
    description:
      'Run WhatsApp campaigns for promotions, announcements, updates and re-engagement, with '
      + 'replies landing in the same shared workspace as your other conversations.',
  },
  teamInbox: {
    path: '/features/whatsapp-team-inbox',
    title: 'WhatsApp Team Inbox for Multiple Agents | ZunoPilot',
    description:
      'Let multiple agents handle one business WhatsApp number without duplicate replies. '
      + 'Shared visibility, internal notes, clean handover and human takeover.',
  },
  businessApi: {
    path: '/whatsapp-business-api',
    title: 'WhatsApp Business API for Companies | ZunoPilot',
    description:
      'Connect WhatsApp with your software, workflows and integrations for scalable business '
      + 'messaging, automated notifications and multi-agent customer communication.',
  },
  industries: {
    path: '/industries',
    title: 'WhatsApp Automation by Industry | ZunoPilot',
    description:
      'How restaurants, ecommerce, real estate, education and service businesses use WhatsApp '
      + 'automation for enquiries, reminders, follow-ups and campaigns.',
  },

  /* ---------------------------- Solution detail --------------------------- */
  leadManagement: {
    path: '/solutions/lead-management',
    title: 'WhatsApp Lead Management Software | ZunoPilot',
    description:
      'Capture WhatsApp enquiries, qualify prospects automatically and keep follow-ups on '
      + 'schedule, so leads reach your sales team with context instead of going quiet.',
  },
  salesAutomation: {
    path: '/solutions/sales-automation',
    title: 'WhatsApp Sales Automation for Teams | ZunoPilot',
    description:
      'Automate the repeatable half of selling on WhatsApp: first responses, qualification and '
      + 'follow-ups, so representatives work qualified opportunities.',
  },
  customerSupport: {
    path: '/solutions/customer-support',
    title: 'WhatsApp Customer Support Software | ZunoPilot',
    description:
      'Handle routine support requests with WhatsApp workflows and AI assistance, and escalate '
      + 'to agents with the full conversation history attached.',
  },
  marketingAutomation: {
    path: '/solutions/marketing-automation',
    title: 'WhatsApp Marketing Automation | ZunoPilot',
    description:
      'Reach customers with WhatsApp promotions, announcements and re-engagement campaigns, on '
      + 'a channel where a reply becomes a conversation.',
  },
  customerEngagement: {
    path: '/solutions/customer-engagement',
    title: 'WhatsApp Customer Engagement Platform | ZunoPilot',
    description:
      'Stay connected after the first sale with WhatsApp reminders, updates, follow-ups and '
      + 're-engagement built around real customer moments.',
  },

  pricing: {
    path: '/pricing',
    title: 'Pricing – ZunoPilot WhatsApp Automation Plans',
    description:
      'Plans for WhatsApp automation, shared team inbox, broadcasts and AI replies. '
      + 'Prices in rupees, billed monthly or yearly, with GST shown before you pay.',
  },
  contact: {
    path: '/contact',
    title: 'Contact ZunoPilot – Talk to Our Team',
    description:
      'Questions about WhatsApp automation for your business, or about your existing '
      + 'workspace? Send us a message and someone from the ZunoPilot team will reply.',
  },
  privacy: {
    path: '/privacy',
    title: 'Privacy Policy – ZunoPilot',
    description:
      'How ZunoPilot handles your business data and your customers\' WhatsApp messages: '
      + 'what we store, who we share it with, and the rights you have over it.',
  },
  terms: {
    path: '/terms',
    title: 'Terms of Service – ZunoPilot',
    description:
      'The terms that apply to using ZunoPilot for WhatsApp business messaging, including '
      + 'your responsibilities under Meta\'s WhatsApp Business policies.',
  },
} satisfies Record<string, PageHead>;
