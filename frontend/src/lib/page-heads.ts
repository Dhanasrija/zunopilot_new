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
  numberMasking: {
    path: '/features/whatsapp-number-masking',
    title: 'WhatsApp Number Masking for Business | ZunoPilot',
    description:
      'Protect employee contact information and manage customer-facing WhatsApp communication '
      + "with ZunoPilot's business number masking solution.",
  },
  campaigns: {
    path: '/features/whatsapp-campaigns',
    title: 'WhatsApp Campaigns for Business | ZunoPilot',
    description:
      'Plan and manage WhatsApp campaigns for customer outreach, product updates, lead '
      + 'engagement, events, and relevant business communication with ZunoPilot.',
  },
  teamInbox: {
    path: '/features/whatsapp-team-inbox',
    title: 'WhatsApp Team Inbox for Multiple Agents | ZunoPilot',
    description:
      'Let multiple agents handle one business WhatsApp number without duplicate replies. '
      + 'Shared visibility, internal notes, clean handover and human takeover.',
  },
  businessApi: {
    path: '/features/whatsapp-business-api',
    title: 'WhatsApp Business API for Business | ZunoPilot',
    description:
      'Connect WhatsApp with business workflows, customer messaging, automation, AI, and team '
      + "communication using ZunoPilot's WhatsApp Business API solution.",
  },
  /*
   * **`/login` is here but is not a public page**, which is why it carries `path: null`
   * and `noindex`. It is in this table rather than set inline because it is now the most
   * internally-linked URL on the site — every "Get Started" on every page points at it —
   * and a head that important should be reviewed next to the others rather than buried in
   * a component. `document-head.test.ts` skips it for the route/sitemap cross-checks by
   * looking only at entries with a non-null `path`.
   */
  login: {
    path: null,
    robots: 'noindex, follow',
    title: 'Sign in to ZunoPilot',
    description:
      'Sign in to your ZunoPilot workspace to manage WhatsApp conversations, campaigns, '
      + 'automations and your team from one place.',
  },

  /* ---------------------------- Solution detail --------------------------- */
  /*
   * **These six are placeholders that are nonetheless indexable, by explicit decision.**
   *
   * The routes render `pages/ComingSoon.tsx`, not the full `DetailPage`. Normally a page
   * that says "the full page is being written" should be `noindex` — a thin page ranking
   * for "whatsapp lead management" burns the click and teaches the ranking system that the
   * site does not answer the query, which is why they *were* `noindex` and absent from the
   * sitemap.
   *
   * That was reversed on request: these URLs are to appear in `sitemap.xml`, and a sitemap
   * entry is a request to index, so the `noindex` had to go with it — the two cannot both
   * be true, and leaving both would only log "Submitted URL marked noindex" in Search
   * Console while changing nothing.
   *
   * The mitigation, since they are being indexed: `ComingSoon` renders each page's real
   * `intro` copy from `lib/marketing-content.ts` alongside the notice, so what gets indexed
   * is a couple of hundred accurate words on the topic rather than sixty words of apology.
   * The full pages are still written and still sitting in that file behind
   * `pages/DetailPage.tsx` — routing them back is a one-line change per page and is the
   * real fix.
   */
  industries: {
    path: '/industries',
    title: 'WhatsApp Automation by Industry | ZunoPilot',
    description:
      'How restaurants, ecommerce, real estate, education and service businesses use WhatsApp '
      + 'automation for enquiries, reminders, follow-ups and campaigns.',
  },
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
