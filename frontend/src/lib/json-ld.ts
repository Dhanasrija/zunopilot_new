import { useEffect } from 'react';

/*
 * Structured data for a route, injected at runtime.
 *
 * **Why a hook and not a tag in index.html.** index.html already carries the
 * Organization / WebSite / SoftwareApplication graph, and those are true of every
 * page. FAQ markup is not: an `FAQPage` block describing the home page's questions
 * would be attached to /pricing and /terms as well, and Google treats structured
 * data that does not match the visible page as a rich-result violation. So the
 * per-page graph has to be per-page, and in a client-rendered SPA that means the
 * component that owns the questions also owns the script tag.
 *
 * The same caveat as `document-head.ts` applies and is worth restating: social
 * scrapers do not execute JavaScript, so they will never see this. Google does, and
 * Google is the only consumer of `FAQPage` markup — so unlike og tags, nothing is
 * lost here.
 *
 * **The tag is removed on unmount.** Without that, navigating home → /features
 * would leave both FAQ graphs in the head and the page would claim questions it
 * does not answer. Each mount owns exactly one node, tracked by the element handle
 * rather than by a selector, so two pages mounting at once (a transition) cannot
 * delete each other's.
 */

export interface FaqEntry {
  question: string;
  answer: string;
}

/** Build the `FAQPage` graph Google expects from a list of question/answer pairs. */
export const faqPageSchema = (faqs: readonly FaqEntry[]): object => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqs.map((faq) => ({
    '@type': 'Question',
    name: faq.question,
    acceptedAnswer: {
      '@type': 'Answer',
      text: faq.answer,
    },
  })),
});

/**
 * Attach a JSON-LD graph to the document head for as long as the caller is mounted.
 *
 * `schema` is stringified inside the effect and the *string* is the dependency, so a
 * caller may pass a fresh object literal on every render without the tag being torn
 * down and rebuilt each time.
 */
export const useJsonLd = (schema: object): void => {
  const json = JSON.stringify(schema);

  useEffect(() => {
    const tag = document.createElement('script');
    tag.type = 'application/ld+json';
    tag.textContent = json;
    document.head.appendChild(tag);
    return () => { tag.remove(); };
  }, [json]);
};

/** Convenience: the FAQ graph and its lifecycle in one call. */
export const useFaqSchema = (faqs: readonly FaqEntry[]): void => {
  useJsonLd(faqPageSchema(faqs));
};

/* -------------------------------------------------------------------------- */
/*                                 Breadcrumbs                                 */
/* -------------------------------------------------------------------------- */

export interface Crumb {
  name: string;
  /** Path with a leading slash. The absolute URL is built here. */
  path: string;
}

const SITE = 'https://zunopilot.com';

/**
 * `BreadcrumbList` for a page nested under a hub.
 *
 * Worth the twenty lines: Google renders the trail in place of the raw URL in the
 * result, so `zunopilot.com › Features › WhatsApp Number Masking` appears instead of
 * `zunopilot.com/features/whatsapp-number-masking`. It also states the hierarchy
 * explicitly rather than leaving it to be inferred from the URL, which is what lets a
 * detail page inherit relevance from its hub instead of competing with it.
 */
export const breadcrumbSchema = (crumbs: readonly Crumb[]): object => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: crumbs.map((crumb, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: crumb.name,
    item: `${SITE}${crumb.path}`,
  })),
});

export const useBreadcrumbSchema = (crumbs: readonly Crumb[]): void => {
  useJsonLd(breadcrumbSchema(crumbs));
};
