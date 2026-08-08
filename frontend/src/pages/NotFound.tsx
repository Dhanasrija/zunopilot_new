import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import PublicHeader from '@/components/layout/PublicHeader';
import { useAuthStore } from '@/stores/auth.store';
import { useDocumentHead } from '@/lib/document-head';

/*
 * The page for a URL that does not exist.
 *
 * **What this replaces.** `<Route path="*" element={<Navigate to="/" replace />} />` — every
 * unknown URL silently became the home page. Three separate problems in one line:
 *
 *   • The visitor is told nothing. A stale link, a typo and a deleted page all land on the
 *     marketing home page, which reads as "the site is broken" rather than "that address is
 *     wrong". `replace` made it worse: the back button could not return to the bad URL, so
 *     you could not even see what you had mistyped.
 *   • To Google it is a soft 404. `/blog` answered 200 with the home page's content, so every
 *     dead inbound link became another duplicate of `/` competing with it.
 *   • An operator who mistypes a URL inside the app was thrown out to the website.
 *
 * **A static SPA cannot answer HTTP 404.** nginx sent 200 with index.html before React
 * existed, and that is the deal with client-side routing — a real 404 status needs the server
 * to know the app's routes. `noindex` is what keeps this out of the index instead, which is
 * Google's own recommendation for the case. The `location.pathname` regex fix that landed
 * earlier covers the other half: a missing *file* does get a real 404.
 */

export default function NotFound() {
  const { pathname } = useLocation();
  const token = useAuthStore((s) => s.token);

  useDocumentHead({
    title: 'Page not found – ZunoPilot',
    description:
      'That address does not exist on zunopilot.com. Head back to the home page, or tell us '
      + 'about the link that brought you here so we can fix it.',
    // No canonical: it must not claim to be the home page — that is exactly the duplicate
    // signal that took four real pages out of the index — and it cannot claim itself.
    path: null,
    robots: 'noindex, follow',
  });

  return (
    <div
      className="min-h-screen bg-no-repeat bg-cover bg-center flex flex-col"
      style={{ backgroundImage: "url('/login-bg.png')" }}
    >
      <PublicHeader />

      <main className="flex-1 flex items-center px-4 sm:px-6 lg:px-8 py-12">
        <div className="max-w-2xl mx-auto text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-violet-600">404</p>

          {/*
            States the fact and does not apologise. "Oops" and "something went wrong" both
            describe a feeling instead of a cause; the address is the cause.
          */}
          <h1 className="mt-3 text-4xl sm:text-5xl font-extrabold tracking-tight text-slate-900">
            This page doesn&rsquo;t <span className="text-violet-600">exist</span>
          </h1>

          <p className="mt-4 text-base sm:text-lg text-slate-600">
            Nothing lives at this address. It may have moved, or there may be a typo in it.
          </p>

          {/*
            The path, so a typo is visible — and on its own line rather than inline in the
            sentence above. Inline, a long URL wrapped into three ragged blocks of monospace
            and broke the prose around it; standing alone it reads as the thing to compare
            against what you meant to type.

            **The pathname only, never the query string.** A mistyped support link carries a
            single-use access token in `?token=`, and putting that on screen invites it into
            the screenshot somebody sends to support.
          */}
          <code className="mt-6 inline-block max-w-full rounded-lg bg-slate-900/5 px-3 py-2 font-mono text-sm text-slate-800 break-all">
            {pathname}
          </code>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {/*
              Signed in, the useful exit is the app, not the marketing site. The header offers
              this too, but somebody who has just been told they are lost should not have to
              go looking in the corner for the way out.
            */}
            {token ? (
              <Link to="/dashboard">
                <Button className="rounded-full bg-violet-600 hover:bg-violet-700 px-6 h-11 text-sm shadow-md shadow-violet-200">
                  Back to dashboard
                </Button>
              </Link>
            ) : (
              <Link to="/">
                <Button className="rounded-full bg-violet-600 hover:bg-violet-700 px-6 h-11 text-sm shadow-md shadow-violet-200">
                  Back to home
                </Button>
              </Link>
            )}
            <Link to="/pricing">
              <Button variant="outline" className="rounded-full px-6 h-11 text-sm">
                See pricing
              </Button>
            </Link>
          </div>

          {/*
            A dead link is worth hearing about, and the person looking at it is the only one
            who knows it exists. `/contact` already accepts an `interest` parameter.
          */}
          <p className="mt-8 text-sm text-slate-600">
            Followed a link to get here?{' '}
            <Link
              to="/contact?interest=Broken+link"
              className="font-medium text-violet-600 underline underline-offset-4 hover:text-violet-700"
            >
              Tell us
            </Link>{' '}
            and we&rsquo;ll fix it.
          </p>
        </div>
      </main>
    </div>
  );
}
