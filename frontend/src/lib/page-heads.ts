import type { PageHead } from './document-head';

/*
 * The head for each public page.
 *
 * Together in one file rather than inline in five components, because the set has to be read
 * as a set: the titles share a shape, the descriptions must not repeat each other, and every
 * `path` here has to match both the route in App.tsx and the `<loc>` in public/sitemap.xml. A
 * canonical that disagrees with the sitemap is the bug this whole module exists to fix.
 *
 * Lengths are deliberate. Google truncates titles around 60 characters and descriptions around
 * 160; each of these is inside that, so nothing is cut. The home page's two strings are the
 * ones already in index.html and are re-stated here so the table is complete — the static tags
 * remain what non-JS scrapers read.
 */

export const PAGE_HEADS = {
  landing: {
    path: '/',
    title: 'ZunoPilot – AI-Powered WhatsApp Business Automation Platform',
    description:
      "Automate WhatsApp marketing, customer support, broadcasts, AI chatbots, and CRM "
      + "integrations with ZunoPilot's powerful business messaging platform.",
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
