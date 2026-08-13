import { describe, expect, it } from 'vitest';
import { crumbsForPath } from './breadcrumbs';
import { PAGE_HEADS } from './page-heads';
import { FEATURE_LINKS, SOLUTION_LINKS } from './marketing-nav';

/*
 * Breadcrumbs, for every page.
 *
 * **The defect this exists for.** Four of nineteen public pages had a trail, because four
 * feature pages happened to declare a local `CRUMBS` constant and pass it to `PageHero`.
 * Fifteen had no trail on screen and no `BreadcrumbList` graph, so Google printed a bare URL
 * where it could have printed `zunopilot.com › Features › WhatsApp Team Inbox`. Deriving the
 * trail from the path fixed it; this is what stops it regressing to per-page arrays.
 */

describe('every public page gets a trail', () => {
  const publicPaths = Object.values(PAGE_HEADS)
    .map((h) => h.path)
    .filter((p): p is string => p !== null);

  it.each(publicPaths)('%s has at least Home plus itself', (path) => {
    const crumbs = crumbsForPath(path);
    if (path === '/') {
      // One crumb, which `PageBreadcrumbs` renders as nothing. "Home" on the home page is
      // noise, and a single-item BreadcrumbList is not worth emitting.
      expect(crumbs).toHaveLength(1);
      return;
    }
    expect(crumbs.length).toBeGreaterThanOrEqual(2);
    expect(crumbs[0]).toEqual({ name: 'Home', path: '/' });
    expect(crumbs.at(-1)!.path).toBe(path);
  });

  it.each(publicPaths)('%s names every crumb', (path) => {
    // An empty label renders an invisible link and an invalid `ListItem`. The `titleCase`
    // fallback means this can only fail if a path is a single trailing slash.
    for (const crumb of crumbsForPath(path)) {
      expect(crumb.name.trim().length, `${path}: empty crumb name`).toBeGreaterThan(0);
    }
  });
});

describe('the trail mirrors the navigation', () => {
  it.each(FEATURE_LINKS.map((l) => [l.href, l.label] as const))(
    '%s reads Home / Features / %s',
    (href, label) => {
      expect(crumbsForPath(href).map((c) => c.name)).toEqual(['Home', 'Features', label]);
    },
  );

  it.each(SOLUTION_LINKS.filter((l) => l.href.startsWith('/solutions/')).map((l) => [l.href, l.label] as const))(
    '%s reads Home / Solutions / %s',
    (href, label) => {
      expect(crumbsForPath(href).map((c) => c.name)).toEqual(['Home', 'Solutions', label]);
    },
  );

  it('**uses the nav label, not the h1**', () => {
    // The team inbox page's h1 is "Give Your Team One Place to Work on WhatsApp
    // Conversations". A crumb is a position marker, and Google's guidance is that the trail
    // should mirror the site's navigation — so it reads "WhatsApp Team Inbox".
    expect(crumbsForPath('/features/whatsapp-team-inbox').at(-1)!.name)
      .toBe('WhatsApp Team Inbox');
  });

  it('puts the hubs one level deep, not under themselves', () => {
    expect(crumbsForPath('/features').map((c) => c.name)).toEqual(['Home', 'Features']);
    expect(crumbsForPath('/solutions').map((c) => c.name)).toEqual(['Home', 'Solutions']);
  });

  it('treats /industries as a top-level page', () => {
    // It is listed under the Solutions dropdown but its URL is not under `/solutions`, so a
    // trail claiming otherwise would contradict the address bar.
    expect(crumbsForPath('/industries').map((c) => c.name))
      .toEqual(['Home', 'Industry Solutions']);
  });
});

describe('robustness', () => {
  it('normalises a trailing slash', () => {
    // The supplied copy writes internal links with trailing slashes. Both forms must resolve
    // to the same trail, or a link from that copy would produce a title-cased fallback label.
    expect(crumbsForPath('/features/whatsapp-team-inbox/'))
      .toEqual(crumbsForPath('/features/whatsapp-team-inbox'));
  });

  it('falls back to a title-cased segment rather than throwing', () => {
    // Breadcrumbs are decoration on a page that is already rendering. A throw here would take
    // the page down with it, which is a far worse outcome than an imperfect label.
    expect(crumbsForPath('/features/some-unknown-page').at(-1)!.name)
      .toBe('Some Unknown Page');
  });

  it('handles the root and a bare slash identically', () => {
    expect(crumbsForPath('//')).toEqual(crumbsForPath('/'));
  });
});
